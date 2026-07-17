/** In-memory repository for datasets used during the current SPUT session. */
export class DatasetStore {
  #datasets = new Map();

  add(dataset, id = crypto.randomUUID()) {
    this.#datasets.set(id, dataset);
    return id;
  }

  get(id) {
    return this.#datasets.get(id) ?? null;
  }

  entries(ids = []) {
    return [...new Set(ids)]
      .map((id) => ({ id, dataset: this.get(id) }))
      .filter((entry) => entry.dataset);
  }

  replace(id, dataset) {
    if (!this.#datasets.has(id)) return false;
    this.#datasets.set(id, dataset);
    return true;
  }
}
