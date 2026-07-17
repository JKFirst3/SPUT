/** Owns the state transition from a dashboard question to guided analysis. */
export class AnalysisNavigator {
  constructor(state) {
    this.state = state;
  }

  selectQuestion(variable, poolGroup) {
    if (!variable) return false;
    this.state.analysisSelection = [variable.id];
    this.state.analysisGoal = variable.kind === "text" ? "text" : "overview";
    this.state.openPoolGroups.add(poolGroup);
    return true;
  }
}
