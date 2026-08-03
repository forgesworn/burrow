;(() => {
  let nextId = 1
  const pending = new Map()

  const request = (method, template) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      window.gopherkindNip07TestBridge(JSON.stringify({ id, method, template }))
    })

  window.__gopherkindNip07TestResolve = (id, result, error) => {
    const waiting = pending.get(id)
    if (!waiting) return
    pending.delete(id)
    if (error) waiting.reject(new Error(error))
    else waiting.resolve(JSON.parse(result))
  }

  window.nostr = {
    getPublicKey: () => request('getPublicKey'),
    signEvent: (template) => request('signEvent', template),
  }
})()
