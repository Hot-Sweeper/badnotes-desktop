"""Read this laptop's touchscreen without libinput pen-proximity arbitration.

Never grabs the device. Requires read permission for this touchscreen only.
"""
import fcntl
import json
import os
from pathlib import Path
import select
import struct
import sys

DEVICE_NAME = 'ELAN2513:00 04F3:422B'
EVENT = struct.Struct('@llHHi')
EV_SYN, EV_KEY, EV_ABS, SYN_REPORT, SYN_DROPPED = 0, 1, 3, 0, 3
SLOT, X, Y, TRACKING_ID = 0x2f, 0x35, 0x36, 0x39
BTN_TOUCH, BTN_TOOL_PEN, BTN_TOOL_RUBBER = 0x14a, 0x140, 0x141
BTN_STYLUS, BTN_STYLUS2 = 0x14b, 0x14c


def pen_keys(fd):
    # EVIOCGKEY: tip contact is independent of pen proximity and barrel buttons.
    keys = fcntl.ioctl(fd, 0x80604518, bytes(96))
    pressed = lambda code: bool(keys[code // 8] & (1 << (code % 8)))
    return pressed(BTN_TOUCH), pressed(BTN_TOOL_PEN) or pressed(BTN_TOOL_RUBBER)


def pen_button_keys(fd):
    keys = fcntl.ioctl(fd, 0x80604518, bytes(96))
    pressed = lambda code: bool(keys[code // 8] & (1 << (code % 8)))
    return pressed(BTN_STYLUS), pressed(BTN_STYLUS2), pressed(BTN_TOOL_RUBBER)


class PenButtons:
    """The upper side button may virtually invert the pen into an eraser tool."""
    def __init__(self, primary=False, secondary=False, eraser=False):
        self.keys = {BTN_STYLUS: primary, BTN_STYLUS2: secondary, BTN_TOOL_RUBBER: eraser}
        self.previous = None

    def feed(self, kind, code, value):
        if kind == EV_KEY and code in self.keys:
            self.keys[code] = bool(value)
        if kind == EV_SYN and code == SYN_REPORT:
            current = (self.keys[BTN_STYLUS], self.keys[BTN_STYLUS2] or self.keys[BTN_TOOL_RUBBER])
            if current != self.previous:
                self.previous = current
                return {'type': 'pen-buttons', 'primary': current[0], 'secondary': current[1]}
        return None


class PenContact:
    def __init__(self, contact=False, proximity=False):
        self.contact, self.proximity = contact, proximity
        self.previous = None
        self.tools = {BTN_TOOL_PEN: proximity, BTN_TOOL_RUBBER: False}

    def feed(self, kind, code, value):
        if kind == EV_KEY:
            if code == BTN_TOUCH:
                self.contact = bool(value)
            elif code in self.tools:
                self.tools[code] = bool(value)
                self.proximity = any(self.tools.values())
        if kind == EV_SYN and code == SYN_REPORT:
            current = (self.contact, self.proximity)
            if current != self.previous:
                self.previous = current
                return {'type': 'pen-contact', 'contact': self.contact, 'proximity': self.proximity}
        return None


class Contacts:
    def __init__(self, xmin, xmax, ymin, ymax):
        self.axes = (xmin, xmax, ymin, ymax)
        self.slots = {}
        self.current = 0
        self.previous = {}
        self.dropped = False

    def frame(self):
        xmin, xmax, ymin, ymax = self.axes
        active = {}
        for slot in self.slots.values():
            if slot.get('id', -1) < 0 or 'x' not in slot or 'y' not in slot:
                continue
            active[slot['id']] = {'x': max(0, min(1, (slot['x'] - xmin) / (xmax - xmin))),
                                  'y': max(0, min(1, (slot['y'] - ymin) / (ymax - ymin)))}
        events = []
        for identifier, point in self.previous.items():
            if identifier not in active:
                events.append(dict(point, id=identifier, phase='up'))
        for identifier, point in active.items():
            if identifier not in self.previous:
                events.append(dict(point, id=identifier, phase='down'))
            elif point != self.previous[identifier]:
                events.append(dict(point, id=identifier, phase='move'))
        self.previous = active
        return events

    def feed(self, kind, code, value):
        if kind == EV_SYN and code == SYN_DROPPED:
            events = [dict(p, id=i, phase='cancel') for i, p in self.previous.items()]
            self.slots.clear()
            self.previous.clear()
            self.dropped = True
            return events
        if self.dropped:
            if kind == EV_SYN and code == SYN_REPORT:
                self.dropped = False
            return []
        if kind == EV_ABS:
            if code == SLOT:
                self.current = value
            elif code in (X, Y, TRACKING_ID):
                slot = self.slots.setdefault(self.current, {})
                if code == TRACKING_ID:
                    slot['id'] = value
                else:
                    slot['x' if code == X else 'y'] = value
        if kind == EV_SYN and code == SYN_REPORT:
            return self.frame()
        return []


def emit(packet):
    print(json.dumps(packet, separators=(',', ':')), flush=True)


def abs_range(fd, axis):
    # EVIOCGABS returns input_absinfo: value, min, max, fuzz, flat, resolution.
    info = struct.unpack('6i', fcntl.ioctl(fd, 0x80184540 + axis, bytes(24)))
    if info[2] <= info[1]:
        raise ValueError('Invalid touchscreen axis range')
    return info[1], info[2]


def main():
    device = None
    pen_device = None
    for entry in Path('/sys/class/input').glob('event*'):
        try:
            if (entry / 'device/name').read_text().strip() == DEVICE_NAME:
                device = Path('/dev/input') / entry.name
            elif (entry / 'device/name').read_text().strip() == DEVICE_NAME + ' Stylus':
                pen_device = Path('/dev/input') / entry.name
        except OSError:
            continue
    if device is None:
        emit({'type': 'touch-source', 'direct': False, 'reason': 'unsupported-device'})
        return
    try:
        fd = os.open(device, os.O_RDONLY | os.O_NONBLOCK)
    except PermissionError:
        emit({'type': 'touch-source', 'direct': False, 'reason': 'read-permission', 'device': str(device)})
        return
    try:
        contacts = Contacts(*abs_range(fd, X), *abs_range(fd, Y))
        pen_fd = None
        if pen_device:
            try:
                pen_fd = os.open(pen_device, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                pass
        pen = PenContact(*pen_keys(pen_fd)) if pen_fd is not None else None
        buttons = PenButtons(*pen_button_keys(pen_fd)) if pen_fd is not None else None
        emit({'type': 'touch-source', 'direct': True, 'device': str(device), 'penContact': pen is not None})
        if pen:
            emit(pen.feed(EV_SYN, SYN_REPORT, 0))
            emit(buttons.feed(EV_SYN, SYN_REPORT, 0))
        data = b''
        pen_data = b''
        pen_dropped = False
        while True:
            ready, _, _ = select.select([fd, sys.stdin] + ([pen_fd] if pen_fd is not None else []), [], [], 1)
            if sys.stdin in ready and not os.read(sys.stdin.fileno(), 1024):
                break
            if pen_fd in ready:
                pen_data += os.read(pen_fd, EVENT.size * 256)
                while len(pen_data) >= EVENT.size:
                    _, _, kind, code, value = EVENT.unpack_from(pen_data)
                    pen_data = pen_data[EVENT.size:]
                    if kind == EV_SYN and code == SYN_DROPPED:
                        pen_dropped = True
                        continue
                    if pen_dropped:
                        if kind != EV_SYN or code != SYN_REPORT:
                            continue
                        pen = PenContact(*pen_keys(pen_fd))
                        buttons = PenButtons(*pen_button_keys(pen_fd))
                        pen_dropped = False
                    packet = pen.feed(kind, code, value)
                    if packet:
                        emit(packet)
                    packet = buttons.feed(kind, code, value)
                    if packet:
                        emit(packet)
            if fd not in ready:
                continue
            chunk = os.read(fd, EVENT.size * 256)
            if not chunk:
                break
            data += chunk
            events = []
            while len(data) >= EVENT.size:
                _, _, kind, code, value = EVENT.unpack_from(data)
                data = data[EVENT.size:]
                batch = contacts.feed(kind, code, value)
                if kind == EV_SYN and code == SYN_DROPPED:
                    if batch:
                        emit({'type': 'direct-touch', 'events': batch})
                    events = []
                elif batch:
                    events.extend(batch)
                if kind == EV_SYN and code == SYN_REPORT and events:
                    packet = {'type': 'direct-touch', 'events': events}
                    if pen_fd is not None:
                        packet['penContact'] = pen_keys(pen_fd)[0]
                    emit(packet)
                    events = []
    finally:
        os.close(fd)
        if 'pen_fd' in locals() and pen_fd is not None:
            os.close(pen_fd)
        emit({'type': 'touch-source', 'direct': False, 'reason': 'reader-stopped'})


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        emit({'type': 'touch-source', 'direct': False, 'reason': str(error)})
