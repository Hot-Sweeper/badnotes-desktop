function mapTouches(events, display, bounds, viewport = null) {
  const scaleX = viewport?.width ? bounds.width / viewport.width : 1;
  const scaleY = viewport?.height ? bounds.height / viewport.height : 1;
  return events.map(event => ({ ...event,
    x: (display.bounds.x + event.x * display.bounds.width - bounds.x) / scaleX,
    y: (display.bounds.y + event.y * display.bounds.height - bounds.y) / scaleY,
  }));
}
module.exports = { mapTouches };
