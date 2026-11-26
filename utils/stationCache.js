const createStationCache = ({ ttl, now = () => Date.now() }) => {
  const entries = {};
  const pending = {};

  const isFresh = (entry) => entry && now() - entry.updatedAt < ttl;

  const get = (key, fetcher, options = {}) => {
    const { forceRefresh = false } = options;
    const entry = entries[key];

    if (!forceRefresh && isFresh(entry)) {
      return Promise.resolve(entry.data);
    }

    if (pending[key]) {
      return pending[key];
    }

    const request = Promise.resolve()
      .then(fetcher)
      .then((data) => {
        entries[key] = { data, updatedAt: now() };
        return data;
      })
      .finally(() => {
        if (pending[key] === request) {
          delete pending[key];
        }
      });

    pending[key] = request;
    return request;
  };

  const clear = (key) => {
    if (key) {
      delete entries[key];
      return;
    }
    Object.keys(entries).forEach((entryKey) => delete entries[entryKey]);
  };

  return { get, clear };
};

module.exports = { createStationCache };
