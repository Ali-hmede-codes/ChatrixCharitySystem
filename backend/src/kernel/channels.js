/**
 * Transport registry. Features register themselves as primary or fallback.
 * Add a channel = feature.register(ctx.channels.register({...}))
 * Remove a channel = delete the feature from src/features.js
 */
export function createChannelRegistry() {
  const channels = new Map();

  return {
    register(channel) {
      if (!channel?.id) throw new Error("Channel must have an id");
      channels.set(channel.id, channel);
      return () => channels.delete(channel.id);
    },
    unregister(id) {
      channels.delete(id);
    },
    get(id) {
      return channels.get(id) || null;
    },
    list(kind) {
      const all = [...channels.values()];
      return kind ? all.filter((channel) => channel.kind === kind) : all;
    },
    ready(kind) {
      return this.list(kind).filter((channel) => {
        try {
          return channel.ready();
        } catch {
          return false;
        }
      });
    },
  };
}
