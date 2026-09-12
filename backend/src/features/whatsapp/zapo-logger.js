export function zapoLogger(base) {
  return {
    get level() {
      return base.level;
    },
    trace(message, context) {
      base.trace(context || {}, message);
    },
    debug(message, context) {
      base.debug(context || {}, message);
    },
    info(message, context) {
      base.info(context || {}, message);
    },
    warn(message, context) {
      base.warn(context || {}, message);
    },
    error(message, context) {
      base.error(context || {}, message);
    },
    child(bindings) {
      return zapoLogger(base.child(bindings));
    },
  };
}
