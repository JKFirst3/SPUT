export class ProjectManager {
  constructor(api, state, onActivate) {
    this.api = api;
    this.state = state;
    this.onActivate = onActivate;
  }

  async save(name) {
    const result = await this.api.post("/api/projects", {
      id: this.state.project?.id,
      name,
      studyIds: this.state.studies.map((study) => study.id),
      activeStudyId: this.state.datasetId,
    });
    this.state.project = { id: result.id, name: result.name };
    return result;
  }

  async open(id) {
    const project = await this.api.get(`/api/projects/${encodeURIComponent(id)}`);
    this.state.project = { id: project.id, name: project.name };
    this.state.studies = project.studies;
    this.state.selectedStudies.clear();
    const active = project.studies.find((study) => study.id === project.activeStudyId) ?? project.studies[0];
    if (active) this.onActivate(active);
    return project;
  }
}
