const STOPWORDS = new Set(
);

export class TermGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  observe(terms, answerIndex) {
    const unique = [...new Set(terms)];
    unique.forEach((term) => {
      if (!this.nodes.has(term)) this.nodes.set(term, new Set());
      this.nodes.get(term).add(answerIndex);
    });
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const key = [unique[i], unique[j]].sort().join("\u0000");
        this.edges.set(key, (this.edges.get(key) ?? 0) + 1);
      }
    }
  }

  components(minEdge = 2, allowedTerms = new Set(this.nodes.keys())) {
    const adjacency = new Map([...allowedTerms].map((term) => [term, new Set()]));
    this.edges.forEach((weight, key) => {
      if (weight < minEdge) return;
      const [a, b] = key.split("\u0000");
      if (adjacency.has(a) && adjacency.has(b)) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
    });
    const visited = new Set();
    const components = [];
    for (const start of adjacency.keys()) {
      if (visited.has(start)) continue;
      const stack = [start];
      const component = [];
      visited.add(start);
      while (stack.length) {
        const term = stack.pop();
        component.push(term);
        adjacency.get(term).forEach((next) => { if (!visited.has(next)) { visited.add(next); stack.push(next); } });
      }
      components.push(component);
    }
    return components;
  }
}

export class TextAnalysisService {
  tokenize(value) {
    return (String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[a-zäöüß]{4,}/gi) ?? [])
      .filter((term) => !STOPWORDS.has(term));
  }

  analyze(values, limit = 15) {
    const answers = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map(String);
    const graph = new TermGraph();
    const tokenized = answers.map((answer, index) => {
      const terms = this.tokenize(answer);
      graph.observe(terms, index);
      return terms;
    });
    const themes = [...graph.nodes.entries()]
      .map(([label, indices]) => ({ label, count: indices.size, coverage: answers.length ? indices.size / answers.length : 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
    const allowed = new Set(themes.slice(0, 30).map((item) => item.label));
    const topics = graph.components(Math.max(2, Math.ceil(answers.length * 0.03)), allowed)
      .map((terms) => {
        const answerIndices = new Set(terms.flatMap((term) => [...(graph.nodes.get(term) ?? [])]));
        const sortedTerms = terms.sort((a, b) => graph.nodes.get(b).size - graph.nodes.get(a).size).slice(0, 6);
        return {
          label: sortedTerms.slice(0, 3).join(" · "), terms: sortedTerms,
          count: answerIndices.size, coverage: answers.length ? answerIndices.size / answers.length : 0,
          evidence: [...answerIndices].slice(0, 3).map((index) => answers[index]),
        };
      })
      .filter((topic) => topic.count >= 2 && topic.terms.length >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const wordCount = tokenized.reduce((sum, terms) => sum + terms.length, 0);
    return {
      n: answers.length, answers, themes, topics,
      averageWords: answers.length ? wordCount / answers.length : 0,
      quality: {
        method: "Nachvollziehbarer Begriff-Kookkurrenzgraph",
        reviewRequired: true,
        answerCoverage: answers.length ? tokenized.filter((terms) => terms.length).length / answers.length : 0,
        limitations: ["Kontext", "Synonyme", "Verneinungen", "Ironie", "Mehrdeutigkeit"],
      },
    };
  }
}
