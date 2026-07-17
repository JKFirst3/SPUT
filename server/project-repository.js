import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function safeName(value, fallback = "SPUT_Projekt") {
  return String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || fallback;
}

/** Persists complete projects locally. Filter views are intentionally stored elsewhere. */
export class ProjectRepository {
  constructor(directory) {
    this.directory = directory;
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
  }

  async list() {
    const files = (await fs.readdir(this.directory)).filter((file) => file.endsWith(".json"));
    const projects = await Promise.all(files.map(async (file) => {
      try {
        const raw = await fs.readFile(path.join(this.directory, file), "utf8");
        const project = JSON.parse(raw);
        return {
          id: project.id,
          name: project.name,
          studyCount: project.studies?.length ?? 0,
          participantCount: (project.studies ?? []).reduce((sum, study) => sum + (study.dataset?.participants ?? 0), 0),
          updatedAt: project.updatedAt,
        };
      } catch {
        return null;
      }
    }));
    return projects.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save({ id, name, studies, activeStudyId }) {
    const projectId = id || crypto.randomUUID();
    const existing = await this.get(projectId).catch(() => null);
    const now = new Date().toISOString();
    const project = {
      format: "SPUT_PROJECT",
      version: 1,
      id: projectId,
      name: String(name || "Unbenanntes Projekt").trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      activeStudyId,
      studies,
    };
    await fs.writeFile(path.join(this.directory, `${safeName(projectId)}.json`), JSON.stringify(project, null, 2), "utf8");
    return project;
  }

  async get(id) {
    const file = `${safeName(id)}.json`;
    const project = JSON.parse(await fs.readFile(path.join(this.directory, file), "utf8"));
    if (project.format !== "SPUT_PROJECT") throw new Error("Ungültiges SPUT-Projektformat.");
    return project;
  }
}
