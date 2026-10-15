"""Read only this BadNotes process's client geometry from KDE/Wayland.

The temporary KWin observer does not move windows or change desktop settings.
It is unloaded when Electron closes this helper's stdin; nothing is installed.
"""
import json
import math
from pathlib import Path
import signal
import sys
import tempfile

from gi.repository import Gio, GLib


def main(pid):
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    flags = Gio.DBusCallFlags.NONE

    def call(service, path, interface, method, parameters=None):
        return bus.call_sync(service, path, interface, method, parameters, None, flags, 2000, None)

    kwin_owner = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                      'GetNameOwner', GLib.Variant('(s)', ('org.kde.KWin',))).unpack()[0]
    service = f'org.badnotes.WindowGeometry.p{pid}'
    plugin = f'badnotes_geometry_{pid}'
    interface = 'org.badnotes.WindowGeometry'
    xml = f'<node><interface name="{interface}"><method name="Update"><arg type="s" direction="in"/></method></interface></node>'
    loop = GLib.MainLoop()

    def update(connection, sender, path, iface, method, params, invocation):
        if sender != kwin_owner:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'Only KWin can supply geometry')
            return
        try:
            packet = json.loads(params.unpack()[0])
            if packet.get('type') != 'window-geometry' or packet.get('pid') != pid:
                raise ValueError('Wrong window')
            if not all(isinstance(packet.get(key), (int, float)) and math.isfinite(packet[key]) for key in ('x', 'y', 'width', 'height')):
                raise ValueError('Invalid bounds')
            if packet['width'] > 0 and packet['height'] > 0:
                print(json.dumps(packet, separators=(',', ':')), flush=True)
            invocation.return_value(GLib.Variant('()', ()))
        except (ValueError, TypeError, KeyError) as error:
            invocation.return_dbus_error('org.badnotes.InvalidGeometry', str(error))

    info = Gio.DBusNodeInfo.new_for_xml(xml)
    registration = bus.register_object('/WindowGeometry', info.interfaces[0], update, None, None)
    owned = call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                 'RequestName', GLib.Variant('(su)', (service, 4))).unpack()[0]
    if owned != 1:
        raise RuntimeError('Geometry service is already running')
    script = r'''(function () {
        const pid = __PID__, service = __SERVICE__, seen = {};
        function observe(window) {
            if (!window || Number(window.pid) !== pid) return;
            const id = String(window.internalId);
            if (seen[id]) return;
            seen[id] = true;
            function report() {
                if (String(window.caption) !== 'BadNotes') return;
                const r = window.clientGeometry;
                if (!r || r.width <= 0 || r.height <= 0) return;
                let touchOutput = null;
                const outputs = workspace.screens;
                for (let i = 0; i < outputs.length; i++) {
                    if (/^(eDP|LVDS|DSI)/i.test(String(outputs[i].name))) { touchOutput = outputs[i]; break; }
                }
                touchOutput = touchOutput || window.output;
                const d = touchOutput.geometry;
                callDBus(service, '/WindowGeometry', 'org.badnotes.WindowGeometry', 'Update', JSON.stringify({
                    type: 'window-geometry', pid: pid, windowId: id,
                    x: r.x, y: r.y, width: r.width, height: r.height,
                    touchDisplay: {name: String(touchOutput.name), bounds: {x: d.x, y: d.y, width: d.width, height: d.height}}
                }));
            }
            window.clientGeometryChanged.connect(report);
            window.frameGeometryChanged.connect(report);
            window.captionChanged.connect(report);
            window.outputChanged.connect(report);
            report();
        }
        workspace.windowAdded.connect(observe);
        workspace.windowActivated.connect(function (window) { observe(window); });
        const windows = workspace.stackingOrder;
        for (let i = 0; i < windows.length; i++) observe(windows[i]);
    })();'''.replace('__PID__', str(pid)).replace('__SERVICE__', json.dumps(service))

    def stop(*unused):
        loop.quit()
        return False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    GLib.io_add_watch(sys.stdin, GLib.IOCondition.HUP | GLib.IOCondition.IN, stop)
    try:
        with tempfile.TemporaryDirectory(prefix='badnotes-geometry-') as directory:
            script_path = Path(directory) / 'observer.js'
            script_path.write_text(script)
            script_id = call('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'loadScript',
                             GLib.Variant('(ss)', (str(script_path), plugin))).unpack()[0]
            if script_id < 0:
                raise RuntimeError('Could not register window observer')
            for path in (f'/Scripting/Script{script_id}', f'/{script_id}'):
                try:
                    call('org.kde.KWin', path, 'org.kde.kwin.Script', 'run')
                    break
                except GLib.Error:
                    if path == f'/{script_id}':
                        raise
            loop.run()
    finally:
        try:
            call('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', GLib.Variant('(s)', (plugin,)))
        except GLib.Error:
            pass
        bus.unregister_object(registration)


if __name__ == '__main__':
    try:
        main(int(sys.argv[1]))
    except (GLib.Error, OSError, ValueError, RuntimeError) as error:
        print(f'Window geometry unavailable: {error}', file=sys.stderr, flush=True)
        sys.exit(1)
