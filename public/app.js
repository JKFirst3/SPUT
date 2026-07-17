const PRIMARY = "#3b5bf4";
const PRIMARY_RGBA = "rgba(59,91,244,.68)";
const colors = ["#3b5bf4", "#8193f9", "#8b5cf6", "#28b982", "#f4a261", "#e76f8a", "#64748b", "#14b8a6"];

const state = {
  datasetId: null,
  dataset: null,
  summaries: new Map(),
  charts: [],
  variables: [],
  expertVariables: [],
  selectedColumns: new Set(),
  analysisChart: null,
  targetColumns: [],
  currentAnalysis: null,
  studies: [],
  selectedStudies: new Set(),
  analysisSelection: [],
  analysisGoal: "relationship",
  analysisMode: "guided",
  worldMap: null,
  reviewPayload: null,
  openPoolGroups: new Set(),
  openGoalInfo: null,
  interactiveFilters: [],
  interactiveCharts: [],
  hiddenInteractiveCards: new Set(),
  settings: {
    viewStorageMode: localStorage.getItem("sput.viewStorageMode") || "internal",
    sidebarWidth: Number(localStorage.getItem("sput.sidebarWidth")) || 244,
    themeMode: localStorage.getItem("sput.themeMode") || "light",
  },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif";

function applyTheme(mode, rerender = false) {
  const theme = mode === "dark" ? "dark" : "light";
  state.settings.themeMode = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("sput.themeMode", theme);
  Chart.defaults.color = theme === "dark" ? "#aeb8ca" : "#7a8595";
  Chart.defaults.borderColor = theme === "dark" ? "#263245" : "#edf0f5";
  if (!rerender || !state.dataset) return;
  const activeView = $(".view.active")?.id?.replace("View", "") ?? "dashboard";
  renderApplication();
  changeView(activeView);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), 4200);
}

function secondsLabel(seconds) {
  if (seconds === null || seconds === undefined) return "–";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")} min`;
}

function percent(value) {
  return `${Math.round(value * 100)} %`;
}

function shortened(value, length = 108) {
  const string = String(value ?? "");
  return string.length > length ? `${string.slice(0, length).trim()}…` : string;
}

function fileSlug(value, fallback = "sput_export") {
  return String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 90) || fallback;
}

function typeLabel(type) {
  return {
    instruction: "Anweisung",
    single_choice: "Einfachauswahl",
    multiple_choice: "Mehrfachauswahl",
    scale: "Skala",
    nps: "NPS",
    matrix: "Matrix",
    ranking: "Rangfolge",
    numeric: "Numerisch",
    text: "Offene Antwort",
  }[type] || type;
}

function destroyCharts() {
  state.charts.forEach((instance) => instance.destroy());
  state.charts = [];
  state.analysisChart = null;
  state.targetChart = null;
  state.interactiveCharts = [];
  if ($("#demographicSelect")) $("#demographicSelect")._chart = null;
}

function chart(canvas, configuration) {
  normalizeChartTheme(configuration);
  const instance = new Chart(canvas, configuration);
  state.charts.push(instance);
  return instance;
}

function normalizeChartTheme(value) {
  if (state.settings.themeMode !== "dark" || !value || typeof value !== "object") return;
  const replacements = new Map([
    ["#edf1f5", "#3a465a"],
    ["#edf0f5", "#3a465a"],
    ["#e9eef4", "#3a465a"],
    ["#dfe5ed", "#4b5870"],
    ["#5f6a7a", "#c2cad8"],
    ["#7a8595", "#c2cad8"],
  ]);
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === "string" && replacements.has(entry)) value[key] = replacements.get(entry);
    else if (entry && typeof entry === "object") normalizeChartTheme(entry);
  });
}

function numericValue(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return Number(normalized);
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g);
  return matches?.length === 1 ? Number(matches[0]) : null;
}

function inferMetadataKind(column) {
  if (
    column.label === "Dauer der Studie"
  ) return "numeric";
  if (column.label === "Alter" || /einkommen|vermögen/i.test(column.label)) return "categorical";
  const values = state.dataset.records.map((record) => record[column.key]).filter((value) => value && value !== "—");
  if (!values.length) return "empty";
  const numericRatio = values.filter((value) => numericValue(value) !== null).length / values.length;
  if (numericRatio > 0.8) return "numeric";
  const unique = new Set(values).size;
  return unique <= Math.min(35, Math.max(8, values.length * 0.35)) ? "categorical" : "text";
}

function questionKind(question) {
  if (question.type === "instruction") return "instruction";
  if (["single_choice", "multiple_choice"].includes(question.type)) return "categorical";
  if (question.columns.length > 1) return "complex";
  if (["scale", "nps", "numeric"].includes(question.type) && question.columns.length === 1) return "numeric";
  if (["single_choice", "multiple_choice"].includes(question.type)) return "categorical";
  return "text";
}

function buildVariables() {
  const metadata = state.dataset.metadata.map((column) => ({
    id: `column:${column.key}`,
    columnKey: column.key,
    label: column.label,
    shortLabel: column.label,
    area: column.area,
    sourceType: "metadata",
    kind: inferMetadataKind(column),
  }));
  const questions = state.dataset.questions.map((question) => ({
      id: question.id,
      columnKeys: question.columns.map((column) => column.key),
      questionId: question.id,
      label: `${question.displayCode ?? `Q${question.number}`} · ${question.label}`,
      shortLabel: `${question.displayCode ?? `Q${question.number}`} · ${shortened(question.label, 70)}`,
      area: "Fragen",
      sourceType: question.type,
      kind: questionKind(question),
      question,
    }));
  state.variables = [...metadata, ...questions].filter((variable) => !["empty", "instruction"].includes(variable.kind));
  const expertItems = state.dataset.questions
    .filter((question) => question.columns.length > 1)
    .flatMap((question) =>
      question.columns.map((column) => ({
        id: `column:${column.key}`,
        columnKey: column.key,
        questionId: question.id,
        label: `${question.displayCode ?? `Q${question.number}`} · ${question.label} – ${column.label}`,
        shortLabel: `${question.displayCode ?? `Q${question.number}`} · ${column.label}`,
        area: "Fragen · Untervariablen",
        sourceType: question.type,
        kind: ["matrix", "ranking"].includes(question.type) ? "numeric" : "categorical",
        isSubvariable: true,
      })),
    );
  state.expertVariables = [...state.variables, ...expertItems];
}

async function importFile(file, keepView = false) {
  if (!file) return null;
  $("#loadingOverlay").classList.remove("hidden");
  const form = new FormData();
  form.append("file", file);
  try {
    const response = await fetch("/api/import", { method: "POST", body: form });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Import fehlgeschlagen.");
    $("#loadingOverlay").classList.add("hidden");
    const reviewed = await reviewImport(payload);
    if (!reviewed) return null;
    state.datasetId = payload.id;
    state.dataset = reviewed.dataset;
    state.summaries = new Map(reviewed.summaries.map((summary) => [summary.questionId, summary]));
    state.hiddenInteractiveCards = new Set();
    state.interactiveFilters = [];
    if (!state.studies.some((study) => study.id === payload.id)) {
      state.studies.push({ id: payload.id, dataset: reviewed.dataset, summaries: reviewed.summaries, combined: Boolean(reviewed.dataset.sources) });
    }
    buildVariables();
    selectDefaultColumns();
    renderApplication();
    renderStudies();
    if (keepView) changeView("studies");
    return payload;
  } catch (error) {
    toast(error.message);
  } finally {
    $("#loadingOverlay").classList.add("hidden");
    $("#fileInput").value = "";
  }
}

function questionAnswerPreview(dataset, question) {
  const values = [];
  question.columns.forEach((column) => {
    if (/^(Andere|Other)$/i.test(column.label)) return;
    dataset.records.forEach((record) => {
      const value = record[column.key];
      if (value && value !== "—" && !values.includes(value)) values.push(value);
    });
  });
  return values.slice(0, question.type === "text" ? 3 : 12);
}

function reviewTypeOptions(selected) {
  return [
    ["instruction", "Anweisung / Hinweis"],
    ["single_choice", "Einfachauswahl"],
    ["multiple_choice", "Mehrfachauswahl"],
    ["scale", "Bewertungsskala"],
    ["nps", "NPS"],
    ["matrix", "Matrix"],
    ["ranking", "Rangfolge"],
    ["numeric", "Numerische Antwort"],
    ["text", "Offene Antwort"],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function reviewImport(payload) {
  state.reviewPayload = payload;
  const overlay = $("#reviewOverlay");
  $("#reviewStudyName").value = payload.dataset.name;
  const counts = new Map();
  payload.dataset.questions.forEach((question) => counts.set(question.type, (counts.get(question.type) ?? 0) + 1));
  const formatLabel = payload.dataset.schema.mode === "legacy_multisheet"
    ? `Altes Länderformat · ${payload.dataset.schema.sheets.length} Blätter`
    : "Neues Einblattformat";
  $("#reviewSummary").innerHTML =
    `<span>${formatLabel}</span><span>${payload.dataset.questions.length} Fragen</span><span>${payload.dataset.participants} Teilnehmende</span>` +
    [...counts.entries()].slice(0, 4).map(([type, count]) => `<span>${count} ${typeLabel(type)}</span>`).join("");
  $("#reviewQuestions").innerHTML = payload.dataset.questions.map((question) => {
    const preview = questionAnswerPreview(payload.dataset, question);
    const choices = question.review?.choices ?? [];
    const usesChoices = ["single_choice", "multiple_choice"].includes(question.type);
    const editableItems = usesChoices || question.type === "ranking"
      ? choices.map((choice, index) => `<label class="review-option">${question.type === "ranking" ? "Rang-Option" : "Antwortoption"} ${index + 1}<input data-choice-source="${escapeHtml(choice)}" value="${escapeHtml(choice)}" /></label>`).join("")
      : question.type === "matrix"
        ? question.columns
            .filter((column) => !/^(Antwort|Answer|Andere|Other)$/i.test(column.label))
            .map((column, index) => `<label class="review-option">Aussage ${index + 1}<input data-option-key="${column.key}" value="${escapeHtml(column.label)}" /></label>`)
            .join("")
        : "";
    const previews = preview.map((value) => `<span class="theme-chip">${escapeHtml(shortened(value, 70))}</span>`).join("");
    const otherBlock = question.review?.hasOther
      ? `<div class="review-other"><span class="review-other-badge">Andere-Antwort möglich</span><span>Freitexte werden separat gespeichert und nicht als feste Option behandelt.</span>${question.review.otherResponses?.length ? `<div class="theme-list">${question.review.otherResponses.map((value) => `<span class="theme-chip">${escapeHtml(shortened(value, 70))}</span>`).join("")}</div>` : ""}</div>`
      : "";
    return `<article class="review-question" data-question-id="${question.id}">
      <div class="review-question-main">
        <input class="review-include" type="checkbox" checked aria-label="Frage übernehmen" />
        <span class="review-number ${question.type === "instruction" ? "instruction" : ""}">${question.displayCode ?? `Q${question.number}`}</span>
        <textarea class="review-question-text" rows="2" aria-label="Fragetext">${escapeHtml(question.label)}</textarea>
        <select class="review-type">${reviewTypeOptions(question.type)}</select>
        <button class="review-expand" aria-label="Antworten anzeigen">⌄</button>
      </div>
      <div class="review-options">
        ${editableItems}
        ${otherBlock}
        <div class="review-preview"><span class="section-kicker">ERKANNTE ANTWORTEN</span><div class="theme-list">${previews || '<span class="empty-analysis">Keine Antworten vorhanden</span>'}</div></div>
      </div>
    </article>`;
  }).join("");
  $$(".review-include").forEach((checkbox) => {
    checkbox.onchange = () => checkbox.closest(".review-question").classList.toggle("excluded", !checkbox.checked);
  });
  $$(".review-expand").forEach((button) => {
    button.onclick = () => button.closest(".review-question").querySelector(".review-options").classList.toggle("hidden");
  });
  overlay.classList.remove("hidden");
  return new Promise((resolve) => {
    $("#cancelReview").onclick = () => {
      overlay.classList.add("hidden");
      state.reviewPayload = null;
      resolve(null);
    };
    $("#confirmReview").onclick = async () => {
      const button = $("#confirmReview");
      button.disabled = true;
      button.textContent = "Fragen werden übernommen …";
      try {
        const questions = $$(".review-question").map((element) => ({
          id: element.dataset.questionId,
          included: element.querySelector(".review-include").checked,
          label: element.querySelector(".review-question-text").value.trim(),
          type: element.querySelector(".review-type").value,
          optionEdits: [...element.querySelectorAll("[data-option-key]")].map((input) => ({
            key: input.dataset.optionKey,
            label: input.value.trim(),
          })),
          choices: [...element.querySelectorAll("[data-choice-source]")].map((input) => ({
            source: input.dataset.choiceSource,
            label: input.value.trim(),
          })),
        }));
        const response = await fetch(`/api/datasets/${payload.id}/schema`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: $("#reviewStudyName").value, questions }),
        });
        const reviewed = await response.json();
        if (!response.ok) throw new Error(reviewed.error);
        overlay.classList.add("hidden");
        state.reviewPayload = null;
        resolve(reviewed);
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.textContent = "Studie mit geprüften Fragen hinzufügen";
      }
    };
  });
}

async function importFiles(files) {
  const list = [...files];
  for (let index = 0; index < list.length; index += 1) {
    await importFile(list[index], list.length > 1);
  }
}

function activateStudy(study) {
  state.datasetId = study.id;
  state.dataset = study.dataset;
  state.summaries = new Map(study.summaries.map((summary) => [summary.questionId, summary]));
  state.hiddenInteractiveCards = new Set();
  state.interactiveFilters = [];
  buildVariables();
  selectDefaultColumns();
  state.analysisSelection = [];
  renderApplication();
}

function renderApplication() {
  destroyCharts();
  $("#emptyState").classList.add("hidden");
  $("#dashboard").classList.remove("hidden");
  $("#datasetChip").classList.remove("hidden");
  $$(".nav-item").forEach((button) => (button.disabled = false));
  $("#datasetChipText").textContent = state.dataset.name;
  $("#datasetTitle").textContent = state.dataset.name;
  $("#confidence").textContent = `${Math.round(state.dataset.testTypeConfidence * 100)} % sicher erkannt`;
  $("#datasetMeta").textContent =
    `${state.dataset.schema.format} · ${state.dataset.schema.rows - 3} Fälle · ` +
    `${state.dataset.schema.columns} Exportspalten · ${state.dataset.countries.join(", ") || "Keine Länderangabe"}`;
  $("#questionCount").textContent = `${state.dataset.questions.filter((question) => question.type !== "instruction").length} Fragen erkannt`;
  renderKpis();
  renderDemographics();
  renderCompletion();
  renderTargetExplorer();
  renderRegionMap();
  renderInstructionSummary();
  renderQuestions();
  renderInteractiveDashboard();
  renderDataEditor();
  renderAnalysisVariables();
  renderDataPool();
  renderGuidedSelection();
  setAnalysisMode(state.analysisMode);
  changeView("dashboard");
}

function activateCard(element, action) {
  element.onclick = (event) => {
    if (event.target.closest("select, button, label, input")) return;
    action();
  };
  element.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };
}

function renderKpis() {
  const scaleQuestions = state.dataset.questions.filter((question) =>
    ["scale", "nps", "matrix", "ranking", "numeric"].includes(question.type),
  ).length;
  const openQuestions = state.dataset.questions.filter((question) => question.type === "text").length;
  const cards = [
    { label: "TEILNEHMENDE", value: state.dataset.participants.toLocaleString("de-DE"), note: `${state.dataset.complete} vollständig`, action: "participants" },
    { label: "ABSCHLUSSRATE", value: percent(state.dataset.completionRate), note: "Status aus dem Export", action: "status" },
    { label: "Ø TESTDAUER", value: secondsLabel(state.dataset.averageDurationSeconds), note: "pro Teilnahme", action: "duration" },
    { label: "FRAGEBOGEN", value: state.dataset.questions.length, note: `${scaleQuestions} quantitativ · ${openQuestions} offen`, action: "questions" },
  ];
  $("#kpiGrid").innerHTML = cards
    .map((card) => `<article class="kpi-card" tabindex="0" role="button" data-action="${card.action}"><span>${card.label}</span><strong>${card.value}</strong><small>${card.note}</small></article>`)
    .join("");
  $$(".kpi-card").forEach((card) => activateCard(card, () => handleDashboardAction(card.dataset.action)));
}

function handleDashboardAction(action) {
  if (action === "questions") {
    changeView("analysis");
    $("#variableX").focus();
    return;
  }
  const labels = action === "status"
    ? ["Teilnehmer-ID", "Status"]
    : action === "duration"
      ? ["Teilnehmer-ID", "Dauer der Studie", "Startdatum UTC", "Enddatum UTC"]
      : ["Teilnehmer-ID", "Zielgruppe", "Land", "Alter", "Geschlecht"];
  selectColumnsByLabels(labels);
  changeView("data");
}

function metadataDistribution(column, limit = 12) {
  const counts = new Map();
  for (const record of state.dataset.records) {
    const value = record[column.key];
    if (!value || value === "—") continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function demographicColumns() {
  const preferred = ["Zielgruppe", "Land", "Alter", "Geschlecht", "Aktuelles Dienstverhältnis", "Gerät", "Betriebssystem"];
  const columns = preferred
    .map((label) => state.dataset.metadata.find((column) => column.label === label))
    .filter(Boolean);
  const regionColumns = state.dataset.metadata.filter((column) => column.label.startsWith("Region –"));
  return [...columns, ...regionColumns.filter((column) => !columns.includes(column))];
}

function renderDemographics() {
  const select = $("#demographicSelect");
  const available = demographicColumns();
  select.innerHTML = available.map((column) => `<option value="${column.key}">${escapeHtml(column.label)}</option>`).join("");
  const render = () => {
    const column = available.find((candidate) => candidate.key === select.value) || available[0];
    const data = column ? metadataDistribution(column) : [];
    if (select._chart) {
      const index = state.charts.indexOf(select._chart);
      if (index >= 0) state.charts.splice(index, 1);
      select._chart.destroy();
    }
    select._chart = chart($("#demographicChart"), {
      type: "bar",
      data: {
        labels: data.map(([label]) => label),
        datasets: [{ data: data.map(([, count]) => count), backgroundColor: PRIMARY, borderRadius: 7, barThickness: 20 }],
      },
      options: {
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: "#edf1f5" }, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { color: "#5f6a7a" } },
        },
      },
    });
  };
  select.onchange = render;
  render();
  activateCard($("#demographicPanel"), () => {
    $("#targetPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function renderCompletion() {
  const complete = state.dataset.complete;
  const remaining = Math.max(0, state.dataset.participants - complete);
  chart($("#completionChart"), {
    type: "doughnut",
    data: { labels: ["Vollständig", "Sonstige"], datasets: [{ data: [complete, remaining], backgroundColor: [PRIMARY, "#e9eef4"], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: "72%", plugins: { legend: { display: false } } },
  });
  $("#completionLegend").innerHTML = [
    [PRIMARY, "Vollständig", complete],
    ["#dfe5ed", "Sonstige", remaining],
    ["#28b982", "Erkannte Fragen", state.dataset.questions.length],
  ].map(([color, label, value]) => `<div class="legend-row"><i class="legend-color" style="background:${color}"></i><span>${label}</span><strong>${value}</strong></div>`).join("");
  activateCard($("#completionPanel"), () => handleDashboardAction("status"));
}

function targetCandidates() {
  const excluded = /^(Branche|Sprache|Soziale Netzwerke|Spar \/|Abteilung –)/;
  return state.dataset.metadata.filter((column) => {
    if (excluded.test(column.label)) return false;
    const values = state.dataset.records.map((record) => record[column.key]).filter((value) => value && value !== "—");
    const unique = new Set(values).size;
    return values.length >= Math.max(3, state.dataset.participants * 0.05) && unique > 0 && unique <= 30;
  });
}

function renderTargetExplorer() {
  const primarySelect = $("#targetPrimary");
  const secondarySelect = $("#targetSecondary");
  const candidates = targetCandidates();
  const options = candidates.map((column) => `<option value="${column.key}">${escapeHtml(column.label)}</option>`).join("");
  primarySelect.innerHTML = options;
  secondarySelect.innerHTML = options;
  primarySelect.value = candidates.find((column) => column.label === "Zielgruppe")?.key ?? candidates[0]?.key ?? "";
  secondarySelect.value =
    candidates.find((column) => column.label === "Alter")?.key ??
    candidates.find((column) => column.label === "Land")?.key ??
    candidates[1]?.key ??
    candidates[0]?.key ??
    "";

  const render = () => {
    const primary = candidates.find((column) => column.key === primarySelect.value);
    let secondary = candidates.find((column) => column.key === secondarySelect.value);
    if (primary && secondary?.key === primary.key) {
      secondary = candidates.find((column) => column.key !== primary.key) ?? secondary;
      secondarySelect.value = secondary?.key ?? "";
    }
    state.targetColumns = [primary, secondary].filter(Boolean);
    if (!primary || !secondary) {
      $("#targetTable").innerHTML = "<tbody><tr><td>Keine ausreichenden Zielgruppendaten vorhanden.</td></tr></tbody>";
      return;
    }
    const primaryValues = metadataDistribution(primary, 8).map(([label]) => label);
    const secondaryValues = metadataDistribution(secondary, 8).map(([label]) => label);
    const matrix = primaryValues.map((primaryValue) =>
      secondaryValues.map((secondaryValue) =>
        state.dataset.records.filter((record) => record[primary.key] === primaryValue && record[secondary.key] === secondaryValue).length,
      ),
    );
    if (state.targetChart) {
      const index = state.charts.indexOf(state.targetChart);
      if (index >= 0) state.charts.splice(index, 1);
      state.targetChart.destroy();
    }
    state.targetChart = chart($("#targetChart"), {
      type: "bar",
      data: {
        labels: primaryValues,
        datasets: secondaryValues.map((label, index) => ({
          label,
          data: matrix.map((row) => row[index]),
          backgroundColor: colors[index % colors.length],
          borderRadius: 4,
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 8, usePointStyle: true, font: { size: 9 } } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    $("#targetTable").innerHTML = `
      <thead><tr><th>${escapeHtml(primary.label)}</th>${secondaryValues.map((value) => `<th>${escapeHtml(value)}</th>`).join("")}<th>Gesamt</th></tr></thead>
      <tbody>${primaryValues.map((value, rowIndex) => `<tr><td>${escapeHtml(value)}</td>${matrix[rowIndex].map((count) => `<td>${count}</td>`).join("")}<td><strong>${matrix[rowIndex].reduce((sum, count) => sum + count, 0)}</strong></td></tr>`).join("")}</tbody>`;
  };
  primarySelect.onchange = render;
  secondarySelect.onchange = render;
  render();
  activateCard($("#targetPanel"), () => {
    state.selectedColumns = new Set(state.targetColumns.map((column) => `column:${column.key}`));
    const participant = state.dataset.metadata.find((column) => column.label === "Teilnehmer-ID");
    if (participant) state.selectedColumns.add(`column:${participant.key}`);
    renderVariableList();
    renderDataTable();
    changeView("data");
  });
}

async function renderRegionMap() {
  const panel = $("#mapPanel");
  const geography = state.dataset.geography ?? [];
  const hasCountryColumn = state.dataset.metadata.some((column) => /^(Land|Country)$/i.test(column.label));
  panel.classList.toggle("hidden", !hasCountryColumn);
  if (!hasCountryColumn) return;
  if (!geography.length) {
    $("#mapTitle").textContent = "Teilnehmende nach Ländern und Regionen";
    $("#mapDescription").textContent = "Im Export wurden keine geografisch zuordenbaren Länder gefunden.";
    $("#mapCountry").innerHTML = "";
    $("#regionMap").replaceChildren();
    $("#mapLegend").innerHTML = `<p class="empty-analysis">Keine geografischen Angaben vorhanden.</p>`;
    return;
  }
  if (!window.d3 || !window.topojson) return;
  if (!state.worldMap) {
    const response = await fetch("/vendor/world-atlas/countries-110m.json");
    state.worldMap = await response.json();
  }
  const countries = [...new Set(geography.map((entry) => entry.countryCode))];
  const select = $("#mapCountry");
  select.innerHTML = `<option value="all">Alle Länder</option>` + countries
    .map((code) => {
      const entry = geography.find((item) => item.countryCode === code);
      return `<option value="${code}">${escapeHtml(entry.countryName)}</option>`;
    })
    .join("");

  const draw = () => {
    const countryCode = select.value || "all";
    const showingAllCountries = countryCode === "all";
    const entries = showingAllCountries ? geography : geography.filter((entry) => entry.countryCode === countryCode);
    const worldCountryName = entries[0]?.worldCountryName;
    const features = topojson.feature(state.worldMap, state.worldMap.objects.countries).features;
    const activeFeature = features.find((feature) => feature.properties?.name === worldCountryName);
    const svg = d3.select("#regionMap");
    svg.selectAll("*").remove();
    const projection = d3.geoMercator();
    if (showingAllCountries) projection.fitExtent([[35, 25], [725, 335]], { type: "FeatureCollection", features });
    else if (activeFeature) projection.fitExtent([[35, 25], [725, 335]], activeFeature);
    else projection.fitExtent([[35, 25], [725, 335]], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);
    svg
      .selectAll("path")
      .data(showingAllCountries ? features : activeFeature ? [activeFeature] : features)
      .join("path")
      .attr("class", (feature) => showingAllCountries && !entries.some((entry) => entry.worldCountryName === feature.properties?.name) ? "map-country" : "map-country active")
      .attr("d", path);
    const displayedEntries = showingAllCountries
      ? [...new Map(entries.map((entry) => [entry.countryCode, entry])).values()].map((entry) => ({
          ...entry,
          region: entry.countryName,
          count: entries.filter((candidate) => candidate.countryCode === entry.countryCode).reduce((sum, candidate) => sum + candidate.count, 0),
          latitude: entries.filter((candidate) => candidate.countryCode === entry.countryCode).reduce((sum, candidate) => sum + candidate.latitude * candidate.count, 0) / entries.filter((candidate) => candidate.countryCode === entry.countryCode).reduce((sum, candidate) => sum + candidate.count, 0),
          longitude: entries.filter((candidate) => candidate.countryCode === entry.countryCode).reduce((sum, candidate) => sum + candidate.longitude * candidate.count, 0) / entries.filter((candidate) => candidate.countryCode === entry.countryCode).reduce((sum, candidate) => sum + candidate.count, 0),
        }))
      : entries;
    const maxCount = Math.max(...displayedEntries.map((entry) => entry.count), 1);
    const markers = displayedEntries
      .map((entry) => ({ ...entry, point: projection([entry.longitude, entry.latitude]) }))
      .filter((entry) => entry.point);
    svg
      .selectAll("circle")
      .data(markers)
      .join("circle")
      .attr("class", "map-marker")
      .attr("cx", (entry) => entry.point[0])
      .attr("cy", (entry) => entry.point[1])
      .attr("r", (entry) => 5 + Math.sqrt(entry.count / maxCount) * 17)
      .append("title")
      .text((entry) => `${entry.region}: ${entry.count} Teilnehmende`);
    svg
      .selectAll("text")
      .data(markers.filter((entry) => entry.count >= maxCount * 0.18).slice(0, 12))
      .join("text")
      .attr("class", "map-label")
      .attr("x", (entry) => entry.point[0] + 10)
      .attr("y", (entry) => entry.point[1] - 8)
      .text((entry) => entry.region);
    $("#mapTitle").textContent = showingAllCountries ? "Teilnehmende nach Ländern" : `Regionen in ${entries[0]?.countryName ?? "diesem Land"}`;
    $("#mapDescription").textContent = showingAllCountries
      ? "Wähle ein Land, um die Regionen der Teilnehmenden detailliert zu sehen."
      : "Kreise und Liste zeigen die Verteilung innerhalb des ausgewählten Landes.";
    $("#mapLegend").innerHTML = displayedEntries
      .sort((a, b) => b.count - a.count)
      .map((entry) => `<div class="map-region-row"><i></i><span>${escapeHtml(entry.region)}</span><strong>${entry.count}</strong></div>`)
      .join("");
  };
  select.onchange = draw;
  draw();
}

function renderQuestions() {
  const container = $("#questionGrid");
  container.innerHTML = "";
  state.dataset.questions.filter((question) => question.type !== "instruction").forEach((question, index) => {
    const summary = state.summaries.get(question.id) || {};
    const article = document.createElement("article");
    article.className = "question-card";
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", question.type === "instruction" ? `Anweisung ${question.number}` : `Frage ${question.number} analysieren`);
    article.innerHTML = `
      <div class="question-top"><span class="question-number">${question.displayCode ?? `Q${question.number}`}</span><span class="question-type">${typeLabel(question.type)}</span></div>
      <h4 title="${escapeHtml(question.label)}">${escapeHtml(shortened(question.label))}</h4>
      <div class="${question.type === "text" ? "theme-list" : "mini-chart"}" id="questionViz${index}"></div>`;
    container.append(article);
    activateCard(article, () => openQuestionAnalysis(question));
    const target = $(`#questionViz${index}`);
    if (question.type === "text") {
      target.innerHTML = summary.themes?.length
        ? summary.themes.map((theme) => `<span class="theme-chip">${escapeHtml(theme.label)} · ${theme.count}</span>`).join("")
        : `<p class="empty-analysis">Noch keine stabilen Themen erkannt.</p>`;
      return;
    }
    const series = summary.series;
    const distribution = series
      ? series.map((item) => ({ label: item.label, count: item.numeric?.mean ?? item.distribution?.[0]?.count ?? 0 })).slice(0, 8)
      : (summary.distribution || []).slice(0, 8);
    if (!distribution.length) {
      target.innerHTML = `<p class="empty-analysis">Keine auswertbaren Antworten.</p>`;
      return;
    }
    const canvas = document.createElement("canvas");
    target.append(canvas);
    chart(canvas, {
      type: "bar",
      data: {
        labels: distribution.map((item) => shortened(item.label, 24)),
        datasets: [{ data: distribution.map((item) => item.count), backgroundColor: colors[index % colors.length], borderRadius: 5, barThickness: 10 }],
      },
      options: {
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false }, tooltip: { displayColors: false } },
        scales: { x: { beginAtZero: true, ticks: { display: false }, grid: { display: false } }, y: { grid: { display: false }, ticks: { font: { size: 8 } } } },
      },
    });
  });
}

function renderInstructionSummary() {
  const instructions = state.dataset.questions.filter((question) => question.type === "instruction");
  const panel = $("#instructionSummary");
  if (!panel) return;
  panel.classList.toggle("hidden", instructions.length === 0);
  $("#instructionCount").textContent = instructions.length ? `${instructions.length} Hinweise` : "";
  $("#instructionList").innerHTML = instructions
    .map((question) => `<div class="instruction-item"><span>${escapeHtml(question.displayCode ?? `A${question.number}`)}</span><p>${escapeHtml(question.label)}</p></div>`)
    .join("");
}

function openQuestionAnalysis(question) {
  if (question.type === "instruction") {
    toast("Dieser Eintrag ist eine Anweisung und enthält keine auswertbaren Antworten.");
    return;
  }
  const variable = state.variables.find((candidate) => candidate.questionId === question.id);
  changeView("analysis");
  if (variable) {
    $("#variableX").value = variable.id;
    updateCompatibleVariables();
  }
}

function selectDefaultColumns() {
  const preferred = ["Teilnehmer-ID", "Status", "Zielgruppe", "Land", "Alter", "Geschlecht", "Dauer der Studie"];
  const defaults = state.variables.filter((variable) => preferred.includes(variable.shortLabel)).map((variable) => variable.id);
  const firstQuestions = state.variables.filter((variable) => variable.area === "Fragen").slice(0, 3).map((variable) => variable.id);
  state.selectedColumns = new Set([...defaults, ...firstQuestions]);
}

function selectColumnsByLabels(labels) {
  state.selectedColumns = new Set(
    state.variables.filter((variable) => labels.includes(variable.shortLabel)).map((variable) => variable.id),
  );
  renderVariableList();
  renderDataTable();
}

function renderDataEditor() {
  const areas = [...new Set(state.variables.map((variable) => variable.area))];
  $("#variableAreaFilter").innerHTML = `<option value="">Alle Bereiche</option>${areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("")}`;
  $("#variableSearch").oninput = renderVariableList;
  $("#variableAreaFilter").onchange = renderVariableList;
  $("#tableSearch").oninput = renderDataTable;
  $("#selectDefaultColumns").onclick = () => {
    selectDefaultColumns();
    renderVariableList();
    renderDataTable();
  };
  $("#clearColumns").onclick = () => {
    state.selectedColumns.clear();
    renderVariableList();
    renderDataTable();
  };
  renderVariableList();
  renderDataTable();
}

function renderVariableList() {
  if (!state.dataset) return;
  const query = $("#variableSearch").value?.toLowerCase() || "";
  const area = $("#variableAreaFilter").value || "";
  const variables = state.variables.filter((variable) =>
    (!query || variable.label.toLowerCase().includes(query)) && (!area || variable.area === area),
  );
  $("#variableList").innerHTML = variables
    .map((variable) => {
      const selected = state.selectedColumns.has(variable.id);
      return `<button class="variable-item ${selected ? "selected" : ""}" data-key="${variable.id}" title="${escapeHtml(variable.label)}">
        <i class="variable-check">${selected ? "✓" : ""}</i>
        <span class="variable-copy"><strong>${escapeHtml(shortened(variable.shortLabel, 36))}</strong><span>${escapeHtml(variable.area)} · ${variable.kind}</span></span>
      </button>`;
    })
    .join("");
  $$(".variable-item").forEach((button) => {
    button.onclick = () => {
      if (state.selectedColumns.has(button.dataset.key)) state.selectedColumns.delete(button.dataset.key);
      else state.selectedColumns.add(button.dataset.key);
      renderVariableList();
      renderDataTable();
    };
  });
}

function renderDataTable() {
  if (!state.dataset) return;
  const columns = state.variables.filter((variable) => state.selectedColumns.has(variable.id));
  const query = $("#tableSearch").value?.toLowerCase() || "";
  const rows = state.dataset.records
    .filter((record) => !query || columns.some((column) => displayVariableValue(record, column).toLowerCase().includes(query)))
    .slice(0, 500);
  $("#dataStatus").textContent = `${columns.length} Spalten ausgewählt · ${rows.length}${rows.length < state.dataset.participants ? ` von ${state.dataset.participants}` : ""} Fälle sichtbar`;
  $("#emptyTable").classList.toggle("hidden", columns.length > 0);
  $("#dataTable").classList.toggle("hidden", columns.length === 0);
  if (!columns.length) {
    $("#dataTable").innerHTML = "";
    return;
  }
  $("#dataTable").innerHTML = `
    <thead><tr>${columns.map((column) => `<th title="${escapeHtml(column.label)}">${escapeHtml(shortened(column.shortLabel, 34))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((record) => `<tr>${columns.map((column) => {
      const value = displayVariableValue(record, column);
      return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
}

function displayVariableValue(record, variable) {
  if (variable.columnKey) return String(record[variable.columnKey] ?? "");
  if (!variable.question) return "";
  const entries = variable.question.columns
    .map((column) => ({ label: column.label, value: record[column.key] }))
    .filter((entry) => entry.value && entry.value !== "—");
  if (variable.question.columns.length === 1) return String(entries[0]?.value ?? "");
  if (variable.question.type === "multiple_choice") return entries.map((entry) => entry.label).join(", ");
  return entries.map((entry) => `${entry.label}: ${entry.value}`).join(" · ");
}

function rawVariableValues(record, variable) {
  if (variable.columnKey) {
    const value = String(record[variable.columnKey] ?? "").trim();
    return value && value !== "—" ? [value] : [];
  }
  if (!variable.question) return [];
  const entries = variable.question.columns
    .map((column) => ({ label: column.label, value: String(record[column.key] ?? "").trim() }))
    .filter((entry) => entry.value && entry.value !== "—");
  if (variable.question.columns.length === 1) return entries.map((entry) => entry.value);
  if (variable.question.type === "multiple_choice") return entries.map((entry) => entry.label);
  if (["matrix", "ranking"].includes(variable.question.type)) return entries.map((entry) => `${entry.label}: ${entry.value}`);
  return entries.map((entry) => entry.value);
}

function filteredRecords() {
  if (!state.dataset) return [];
  return state.dataset.records.filter((record) =>
    state.interactiveFilters.every((filter) => {
      const variable = state.variables.find((candidate) => candidate.id === filter.variableId);
      if (!variable) return true;
      const values = rawVariableValues(record, variable);
      if (filter.mode === "range") {
        return values.some((value) => {
          const numeric = numericValue(value);
          return numeric !== null && numeric >= filter.min && numeric < filter.max;
        });
      }
      if (filter.mode === "text") {
        return values.some((value) => String(value).toLowerCase().includes(filter.value.toLowerCase()));
      }
      return values.includes(filter.value);
    }),
  );
}

function addInteractiveFilter(filter) {
  const exists = state.interactiveFilters.some((item) =>
    item.variableId === filter.variableId &&
    item.value === filter.value &&
    item.mode === filter.mode &&
    item.min === filter.min &&
    item.max === filter.max,
  );
  if (exists) return;
  state.interactiveFilters.push(filter);
  renderInteractiveDashboard();
}

function removeInteractiveFilter(index) {
  state.interactiveFilters.splice(index, 1);
  renderInteractiveDashboard();
}

function resetInteractiveView() {
  state.interactiveFilters = [];
  state.hiddenInteractiveCards = new Set();
  renderInteractiveDashboard();
}

function distributionForVariable(variable, records, limit = 10) {
  const counts = new Map();
  records.forEach((record) => {
    rawVariableValues(record, variable).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function numericBucketsForVariable(variable, records) {
  const values = records.flatMap((record) => rawVariableValues(record, variable).map(numericValue)).filter((value) => value !== null);
  if (!values.length) return [];
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length <= 12) {
    return unique.map((value) => ({
      label: String(value),
      count: values.filter((candidate) => candidate === value).length,
      mode: "range",
      min: value,
      max: value + 0.000001,
    }));
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bucketCount = Math.min(8, Math.max(4, Math.ceil(Math.sqrt(values.length))));
  const width = (max - min || 1) / bucketCount;
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = min + index * width;
    const end = index === bucketCount - 1 ? max + 0.000001 : start + width;
    return {
      label: `${start.toFixed(1)}–${(end === max + 0.000001 ? max : end).toFixed(1)}`,
      count: values.filter((value) => value >= start && value < end).length,
      mode: "range",
      min: start,
      max: end,
    };
  }).filter((bucket) => bucket.count > 0);
}

function textThemesForVariable(variable, records) {
  const counts = new Map();
  records.forEach((record) => {
    rawVariableValues(record, variable).forEach((value) => {
      const words = String(value).toLowerCase().match(/[a-zäöüß]{4,}/gi) ?? [];
      new Set(words).forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
    });
  });
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function interactiveDatasetVariables() {
  return state.variables.filter((variable) => ["categorical", "numeric", "text"].includes(variable.kind));
}

function interactiveItemsForVariable(variable, records) {
  if (variable.kind === "text") return textThemesForVariable(variable, records);
  if (variable.kind === "numeric") return numericBucketsForVariable(variable, records);
  return distributionForVariable(variable, records, 12);
}

function showInteractiveDetail(variable) {
  const records = filteredRecords();
  const values = records.flatMap((record) => rawVariableValues(record, variable));
  const overlay = $("#interactiveDetailOverlay");
  $("#interactiveDetailTitle").textContent = variable.label;
  $("#interactiveDetailMeta").textContent = `${values.length} Antworten aus ${records.length} sichtbaren Fällen${state.interactiveFilters.length ? " · aktuelle Filter berücksichtigt" : ""}`;
  if (variable.kind === "text") {
    $("#interactiveDetailBody").innerHTML = values.length
      ? `<div class="detail-answer-list">${values.map((value, index) => `<article><strong>${index + 1}</strong><p>${escapeHtml(value)}</p></article>`).join("")}</div>`
      : `<p class="empty-analysis">Für diese Frage sind im aktuellen Segment keine Freitextantworten vorhanden.</p>`;
  } else {
    const distribution = distributionForVariable(variable, records, Number.MAX_SAFE_INTEGER);
    const max = Math.max(...distribution.map((item) => item.count), 1);
    $("#interactiveDetailBody").innerHTML = distribution.length
      ? `<div class="detail-distribution">${distribution.map((item) => `<article><div><strong>${escapeHtml(item.label)}</strong><span>${item.count} · ${Math.round((item.count / Math.max(records.length, 1)) * 100)} %</span></div><i><b style="width:${(item.count / max) * 100}%"></b></i></article>`).join("")}</div>`
      : `<p class="empty-analysis">Für diese Frage sind im aktuellen Segment keine Antworten vorhanden.</p>`;
  }
  overlay.classList.remove("hidden");
}

function closeInteractiveDetail() {
  $("#interactiveDetailOverlay").classList.add("hidden");
}

function renderInteractiveDashboard() {
  if (!state.dataset || !$("#interactiveGrid")) return;
  state.interactiveCharts.forEach((instance) => {
    const index = state.charts.indexOf(instance);
    if (index >= 0) state.charts.splice(index, 1);
    instance.destroy();
  });
  state.interactiveCharts = [];
  const records = filteredRecords();
  const variables = interactiveDatasetVariables();
  const locked = records.length <= 1;
  const visibleCards = variables
    .map((variable, index) => ({ variable, index, items: interactiveItemsForVariable(variable, records) }))
    .filter((card) => card.items.length > 0 && !state.hiddenInteractiveCards.has(card.variable.id));
  $("#interactiveStatus").textContent =
    `${records.length} von ${state.dataset.records.length} Fällen sichtbar · ${state.interactiveFilters.length} aktive Filter${locked ? " · weiterer Filter gesperrt" : ""}`;
  $("#filteredRecordTitle").textContent =
    state.interactiveFilters.length ? `${records.length} passende Fälle` : "Alle Teilnehmenden";
  $("#interactiveFilters").innerHTML = state.interactiveFilters.length
    ? state.interactiveFilters.map((filter, index) => `<button class="filter-chip" data-filter-index="${index}"><span>${escapeHtml(filter.label)}</span><strong>${escapeHtml(filter.value)}</strong>×</button>`).join("")
    : `<span class="filter-empty">Noch kein Filter aktiv</span>`;
  $$(".filter-chip").forEach((button) => {
    button.onclick = () => removeInteractiveFilter(Number(button.dataset.filterIndex));
  });

  $("#interactiveGrid").innerHTML = visibleCards.length ? visibleCards.map(({ variable, index, items }) => {
    const isText = variable.kind === "text";
    const canvas = items.length && !isText ? `<div class="interactive-chart"><canvas id="interactiveChart${index}"></canvas></div>` : "";
    const chips = isText
      ? `<div class="theme-list interactive-themes">${items.map((item) => `<button data-filter-variable="${variable.id}" data-filter-mode="text" data-filter-value="${escapeHtml(item.label)}" ${locked ? "disabled" : ""}>${escapeHtml(item.label)} · ${item.count}</button>`).join("")}</div>`
      : "";
    return `<article class="interactive-card" data-variable-id="${variable.id}" tabindex="0" role="button" aria-label="${escapeHtml(variable.label)} detailliert anzeigen">
      <div class="question-top"><span class="question-number">${escapeHtml(variable.shortLabel.split(" · ")[0])}</span><span class="question-type">${variable.kind === "numeric" ? "Zahlen" : variable.kind === "text" ? "Freitext" : "Kategorie"}</span></div>
      <button class="hide-card-button" data-hide-card="${variable.id}" title="Kachel ausblenden" aria-label="Kachel ausblenden">−</button>
      <h4 title="${escapeHtml(variable.label)}">${escapeHtml(shortened(variable.label, 92))}</h4>
      ${canvas}${chips}
    </article>`;
  }).join("") : `<div class="interactive-empty panel"><span>◉</span><strong>Keine Kacheln sichtbar</strong><p>Für das aktuelle Segment gibt es keine weiteren Werte, oder alle passenden Kacheln wurden ausgeblendet.</p></div>`;

  variables.forEach((variable, index) => {
    if (variable.kind === "text") return;
    const canvas = $(`#interactiveChart${index}`);
    if (!canvas) return;
    const items = interactiveItemsForVariable(variable, records);
    if (!items.length) return;
    const chartInstance = chart(canvas, {
      type: variable.kind === "categorical" && items.length <= 5 ? "doughnut" : "bar",
      data: {
        labels: items.map((item) => shortened(item.label, 28)),
        datasets: [{ data: items.map((item) => item.count), backgroundColor: items.map((_, itemIndex) => colors[itemIndex % colors.length]), borderRadius: 6, borderWidth: 0 }],
      },
      options: {
        maintainAspectRatio: false,
        indexAxis: variable.kind === "categorical" && items.length > 5 ? "y" : "x",
        plugins: { legend: { display: variable.kind === "categorical" && items.length <= 5, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { size: 9 } } } },
        scales: variable.kind === "categorical" && items.length <= 5 ? {} : {
          x: { beginAtZero: true, grid: { display: false }, ticks: { precision: 0 } },
          y: { beginAtZero: true, grid: { color: "#edf1f5" }, ticks: { precision: 0, font: { size: 9 } } },
        },
        onClick: (_event, elements) => {
          if (locked) {
            toast("Es ist nur noch ein passender Fall übrig. Weitere Filter sind gesperrt.");
            return;
          }
          const element = elements[0];
          if (!element) return;
          const item = items[element.index];
          if (variable.kind === "numeric" && item.mode === "range") {
            addInteractiveFilter({ variableId: variable.id, label: variable.shortLabel, value: item.label, mode: "range", min: item.min, max: item.max });
          } else {
            addInteractiveFilter({ variableId: variable.id, label: variable.shortLabel, value: item.value ?? item.label, mode: "exact" });
          }
        },
      },
    });
    state.interactiveCharts.push(chartInstance);
  });

  $$(".hide-card-button").forEach((button) => {
    button.onclick = () => {
      state.hiddenInteractiveCards.add(button.dataset.hideCard);
      renderInteractiveDashboard();
    };
  });

  $$(".interactive-themes button").forEach((button) => {
    const variable = state.variables.find((candidate) => candidate.id === button.dataset.filterVariable);
    button.onclick = () =>
      addInteractiveFilter({
        variableId: button.dataset.filterVariable,
        label: variable?.shortLabel ?? "Freitext",
        value: button.dataset.filterValue,
        mode: "text",
      });
  });

  $$(".interactive-card").forEach((card) => {
    const open = () => {
      const variable = state.variables.find((candidate) => candidate.id === card.dataset.variableId);
      if (variable) showInteractiveDetail(variable);
    };
    card.onclick = (event) => {
      if (event.target.closest("button, canvas")) return;
      open();
    };
    card.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    };
  });

  const tableVariables = variables.slice(0, 6);
  $("#interactiveRecords").innerHTML = records.slice(0, 80).map((record, index) => `
    <article class="record-card">
      <strong>Fall ${index + 1}</strong>
      ${tableVariables.map((variable) => `<span><b>${escapeHtml(shortened(variable.shortLabel, 28))}</b>${escapeHtml(shortened(displayVariableValue(record, variable), 80))}</span>`).join("")}
    </article>
  `).join("") || `<p class="empty-analysis">Kein Fall passt zu dieser Filterkombination.</p>`;
}

function aiPromptSettings() {
  return {
    language: $("#aiPromptLanguage").value,
    style: $("#aiPromptStyle").value,
    privacyMode: $("#aiPrivacyMode").value,
    questions: $("#aiPromptQuestions").value.split("\n").map((line) => line.trim()).filter(Boolean),
    extraInstruction: $("#aiPromptExtra").value.trim(),
  };
}

function preparedRecordsForAi(settings) {
  if (settings.privacyMode === "summary") return [];
  return state.dataset.records.map((record) => {
    const next = { ...record };
    if (settings.privacyMode === "reduced") {
      state.dataset.questions.filter((question) => question.type === "text").forEach((question) => {
        question.columns.forEach((column) => {
          if (next[column.key]) next[column.key] = shortened(next[column.key], 180);
        });
      });
    }
    return next;
  });
}

function buildAiPrompt(settings) {
  const questions = settings.questions.map((question, index) => `${index + 1}. ${question}`).join("\n");
  return `Du analysierst eine UserTesting-Studie als generative KI.

Arbeite in dieser Sprache: ${settings.language}.
Stil: ${settings.style}.
Datenschutzmodus: ${settings.privacyMode}.

Nutze zuerst das Datenwörterbuch und das Fragebogen-Schema, bevor du Rohdaten interpretierst. Unterscheide beobachtete Muster klar von Hypothesen. Weise auf kleine Fallzahlen, fehlende Werte und mögliche Scheinkorrelationen hin.

Feste Fragen:
${questions || "1. Welche wichtigsten Muster und Auffälligkeiten sind in der Studie sichtbar?\n2. Welche Segmente unterscheiden sich relevant?\n3. Welche offenen Antworten liefern die stärksten Hinweise für Produktentscheidungen?\n4. Welche Folgefragen oder Hypothesen sollten geprüft werden?"}

${settings.extraInstruction ? `Zusätzliche Anweisung:\n${settings.extraInstruction}` : ""}`;
}

function buildAiExportPayload() {
  const settings = aiPromptSettings();
  return {
    exportType: "SPUT_AI_READABLE_STUDY",
    version: 1,
    createdAt: new Date().toISOString(),
    prompt: {
      settings,
      text: buildAiPrompt(settings),
    },
    study: {
      name: state.dataset.name,
      fileName: state.dataset.fileName,
      testType: state.dataset.testType,
      participants: state.dataset.participants,
      complete: state.dataset.complete,
      completionRate: state.dataset.completionRate,
      averageDurationSeconds: state.dataset.averageDurationSeconds,
      countries: state.dataset.countries,
      schema: state.dataset.schema,
    },
    dataDictionary: state.variables.map((variable) => ({
      id: variable.id,
      label: variable.label,
      shortLabel: variable.shortLabel,
      area: variable.area,
      kind: variable.kind,
      sourceType: variable.sourceType,
      columnKeys: variable.columnKeys ?? (variable.columnKey ? [variable.columnKey] : []),
    })),
    metadataColumns: state.dataset.metadata,
    questions: state.dataset.questions,
    summaries: [...state.summaries.entries()].map(([questionId, summary]) => ({ questionId, ...summary })),
    records: preparedRecordsForAi(settings),
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadText(filename, text, type = "text/markdown;charset=utf-8") {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function openAiExportDialog() {
  if (!state.dataset) return toast("Bitte zuerst eine Studie laden.");
  $("#aiExportName").value = `${fileSlug(state.dataset.name)}_KI_Export_${new Date().toISOString().slice(0, 10)}`;
  $("#aiPromptQuestions").value = [
    "Welche wichtigsten Muster und Auffälligkeiten sind in der Studie sichtbar?",
    "Welche Segmente unterscheiden sich relevant voneinander?",
    "Welche Aussagen aus offenen Antworten sind besonders entscheidungsrelevant?",
    "Welche Hypothesen oder nächsten Research-Schritte ergeben sich aus den Daten?",
  ].join("\n");
  $("#aiPromptExtra").value = "";
  $("#aiExportOverlay").classList.remove("hidden");
}

function closeAiExportDialog() {
  $("#aiExportOverlay").classList.add("hidden");
}

function downloadAiExport() {
  const filename = fileSlug($("#aiExportName").value, "SPUT_KI_Export");
  downloadJson(filename, buildAiExportPayload());
}

function downloadAiMarkdown() {
  const payload = buildAiExportPayload();
  const topQuestions = payload.questions.filter((question) => question.type !== "instruction").slice(0, 20);
  const markdown = `# ${payload.study.name}

## Prompt
${payload.prompt.text}

## Studienkontext
- Teilnehmende: ${payload.study.participants}
- Vollständig: ${payload.study.complete}
- Länder: ${payload.study.countries.join(", ") || "Keine Angabe"}
- Fragen: ${payload.questions.length}

## Fragebogen
${topQuestions.map((question) => `- ${question.displayCode}: ${question.label} (${typeLabel(question.type)})`).join("\n")}

## Hinweis
Die vollständigen Rohdaten und Zusammenfassungen sind im JSON-Export enthalten. Diese Markdown-Datei ist als kompakter Prompt-Begleiter gedacht.
`;
  downloadText(`${fileSlug($("#aiExportName").value, "SPUT_KI_Prompt")}.md`, markdown);
}

function suggestedFilterName() {
  const base = state.interactiveFilters.length
    ? state.interactiveFilters.map((filter) => `${filter.label}_${filter.value}`).join("_")
    : state.dataset?.name ?? "SPUT_Ansicht";
  return fileSlug(base, "SPUT_Ansicht");
}

function openSaveViewDialog() {
  if (!state.dataset) return;
  $("#savedViewName").value = suggestedFilterName();
  $("#savedViewFormat").closest("label").classList.toggle("hidden", state.settings.viewStorageMode === "internal");
  $("#saveViewOverlay").classList.remove("hidden");
}

function closeSaveViewDialog() {
  $("#saveViewOverlay").classList.add("hidden");
}

function saveInteractiveView() {
  const filename = fileSlug($("#savedViewName").value, "SPUT_Ansicht");
  const records = filteredRecords();
  const payload = buildSavedViewPayload($("#savedViewName").value);
  if (state.settings.viewStorageMode === "internal") {
    saveInternalView(payload);
    return;
  }
  if ($("#savedViewFormat").value === "csv") {
    const variables = interactiveDatasetVariables();
    downloadCsv(`${filename}.csv`, [
      variables.map((variable) => variable.shortLabel),
      ...records.map((record) => variables.map((variable) => displayVariableValue(record, variable))),
    ]);
  } else {
    saveExternalJson(filename, payload);
  }
  closeSaveViewDialog();
}

function buildSavedViewPayload(name) {
  return {
    exportType: "SPUT_FILTERED_INTERACTIVE_VIEW",
    version: 2,
    name: String(name || suggestedFilterName()).trim() || suggestedFilterName(),
    createdAt: new Date().toISOString(),
    study: {
      name: state.dataset.name,
      participants: state.dataset.participants,
      datasetId: state.datasetId,
      signature: currentStudySignature(),
    },
    filters: state.interactiveFilters,
    hiddenCards: [...state.hiddenInteractiveCards],
    visibleRecordCount: filteredRecords().length,
    variables: interactiveDatasetVariables().map((variable) => ({
      id: variable.id,
      label: variable.label,
      kind: variable.kind,
      sourceType: variable.sourceType,
    })),
  };
}

function currentStudySignature() {
  if (!state.dataset) return "";
  const variables = interactiveDatasetVariables().map((variable) => `${variable.id}:${variable.kind}:${variable.label}`).join("|");
  return `${state.dataset.name}|${state.dataset.participants}|${state.dataset.questions.length}|${variables}`;
}

function savedViewMatchesCurrentStudy(view) {
  if (!state.dataset) return false;
  if (view.studySignature) return view.studySignature === currentStudySignature();
  if (view.studyName && view.studyName !== state.dataset.name) return false;
  return true;
}

async function saveInternalView(payload) {
  try {
    const response = await fetch("/api/saved-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Ansicht konnte nicht gespeichert werden.");
    closeSaveViewDialog();
    toast(`Ansicht wurde intern gespeichert: ${result.path}`);
  } catch (error) {
    toast(error.message);
  }
}

async function saveExternalJson(filename, payload) {
  try {
    const response = await fetch("/api/external/save-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: filename, payload }),
    });
    if (response.status === 499) return;
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Finder-Speichern ist fehlgeschlagen.");
    toast("Ansicht wurde gespeichert.");
    return;
  } catch {
    // Browser fallback below.
  }
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${filename}.json`,
        types: [{ description: "SPUT Filteransicht", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      toast("Ansicht wurde gespeichert.");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      toast(error.message);
      return;
    }
  }
  downloadJson(filename, payload);
}

function applySavedView(payload) {
  if (!payload || payload.exportType !== "SPUT_FILTERED_INTERACTIVE_VIEW") {
    toast("Diese Datei ist keine SPUT-Filteransicht.");
    return;
  }
  if (payload.study?.name && state.dataset?.name && payload.study.name !== state.dataset.name) {
    toast("Die Ansicht wurde für eine andere Studie gespeichert. Filter werden trotzdem angewendet, wenn Variablen passen.");
  }
  const validVariableIds = new Set(state.variables.map((variable) => variable.id));
  state.interactiveFilters = (payload.filters ?? []).filter((filter) => validVariableIds.has(filter.variableId));
  state.hiddenInteractiveCards = new Set((payload.hiddenCards ?? []).filter((id) => validVariableIds.has(id)));
  renderInteractiveDashboard();
  closeLoadViewDialog();
  toast("Filteransicht wurde geladen.");
}

async function openLoadViewDialog() {
  if (!state.dataset) return toast("Bitte zuerst eine Studie laden.");
  if (state.settings.viewStorageMode === "external") {
    await loadExternalView();
    return;
  }
  $("#loadViewOverlay").classList.remove("hidden");
  await renderSavedViewList();
}

function closeLoadViewDialog() {
  $("#loadViewOverlay").classList.add("hidden");
}

async function renderSavedViewList() {
  const list = $("#savedViewList");
  list.innerHTML = `<div class="saved-view-empty">Gespeicherte Ansichten werden geladen …</div>`;
  try {
    const response = await fetch("/api/saved-views");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Ansichten konnten nicht geladen werden.");
    list.innerHTML = payload.views.length
      ? payload.views.map((view) => {
        const matches = savedViewMatchesCurrentStudy(view);
        return `<div class="saved-view-row ${matches ? "" : "disabled"}">
          <button class="saved-view-item" data-view-id="${escapeHtml(view.id)}" ${matches ? "" : "disabled"} title="${matches ? "Ansicht laden" : "Passt nicht zur aktuell geladenen Studie"}">
            <strong>${escapeHtml(view.name)}</strong>
            <span>${escapeHtml(view.studyName)} · ${view.filterCount} Filter · ${view.hiddenCount} ausgeblendet</span>
            <small>${matches ? new Date(view.updatedAt).toLocaleString("de-DE") : "Nicht passend zur aktuellen Studie"}</small>
          </button>
          <button class="saved-view-delete" data-delete-view="${escapeHtml(view.id)}" title="Ansicht löschen" aria-label="Ansicht löschen">×</button>
        </div>`;
      }).join("")
      : `<div class="saved-view-empty">Noch keine internen Ansichten gespeichert.</div>`;
    $$(".saved-view-item").forEach((button) => {
      button.onclick = async () => {
        if (button.disabled) return;
        const viewResponse = await fetch(`/api/saved-views/${encodeURIComponent(button.dataset.viewId)}`);
        const view = await viewResponse.json();
        if (!viewResponse.ok) return toast(view.error || "Ansicht konnte nicht geladen werden.");
        applySavedView(view);
      };
    });
    $$(".saved-view-delete").forEach((button) => {
      button.onclick = async () => {
        const response = await fetch(`/api/saved-views/${encodeURIComponent(button.dataset.deleteView)}`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) return toast(result.error || "Ansicht konnte nicht gelöscht werden.");
        toast("Ansicht wurde gelöscht.");
        await renderSavedViewList();
      };
    });
  } catch (error) {
    list.innerHTML = `<div class="saved-view-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadExternalView() {
  try {
    const response = await fetch("/api/external/load-view", { method: "POST" });
    if (response.status === 499) return;
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Finder-Laden ist fehlgeschlagen.");
    applySavedView(payload);
    return;
  } catch {
    // Browser fallback below.
  }
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "SPUT Filteransicht", accept: { "application/json": [".json"] } }],
      });
      const file = await handle.getFile();
      applySavedView(JSON.parse(await file.text()));
      return;
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message);
      return;
    }
  }
  $("#externalViewInput").click();
}

function openSettingsDialog() {
  $("#viewStorageMode").value = state.settings.viewStorageMode;
  $("#themeMode").checked = state.settings.themeMode === "dark";
  $("#settingsOverlay").classList.remove("hidden");
}

function closeSettingsDialog() {
  $("#settingsOverlay").classList.add("hidden");
}

function updateStorageMode(value) {
  state.settings.viewStorageMode = value;
  localStorage.setItem("sput.viewStorageMode", value);
}

function updateThemeMode(enabled) {
  applyTheme(enabled ? "dark" : "light", true);
}

function applySidebarWidth(width) {
  const clamped = Math.max(188, Math.min(360, Math.round(width)));
  state.settings.sidebarWidth = clamped;
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  localStorage.setItem("sput.sidebarWidth", String(clamped));
}

function initSidebarResize() {
  applySidebarWidth(state.settings.sidebarWidth);
  const resizer = $("#sidebarResizer");
  if (!resizer) return;
  let resizing = false;
  const move = (event) => {
    if (!resizing) return;
    applySidebarWidth(event.clientX);
  };
  const stop = () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove("resizing-sidebar");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", stop);
  };
  resizer.addEventListener("mousedown", (event) => {
    resizing = true;
    document.body.classList.add("resizing-sidebar");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    event.preventDefault();
  });
}

function analysableVariables() {
  return state.expertVariables.filter((variable) => variable.kind !== "empty");
}

function poolCategory(variable) {
  if (variable.area === "Fragen") {
    if (["multiple_choice", "single_choice"].includes(variable.sourceType)) return "Auswahlfragen";
    if (["matrix", "ranking"].includes(variable.sourceType)) return "Matrix & Rangfolge";
    if (["scale", "nps", "numeric"].includes(variable.sourceType)) return "Skalen & Zahlen";
    if (variable.sourceType === "text") return "Offene Antworten";
    return {
      text: "Offene Antworten",
      numeric: "Skalen & Zahlen",
      categorical: "Auswahlfragen",
      complex: "Matrix & Rangfolge",
    }[variable.kind] ?? "Weitere Fragen";
  }
  if (["Session", "Studienvergleich"].includes(variable.area) || ["Studie", "Quelldatei", "Status", "Dauer der Studie"].includes(variable.shortLabel)) {
    return "Studie & Durchführung";
  }
  if (variable.area === "Technik") return "Technik & Gerät";
  if (/Land|Region|Alter|Geschlecht|Einkommen|Vermögen|Zielgruppe|Elternstatus|Dienstverhältnis/.test(variable.shortLabel)) {
    return "Zielgruppe & Demografie";
  }
  return "Weitere Merkmale";
}

function renderDataPool() {
  if (!state.dataset) return;
  const query = $("#poolSearch").value?.toLowerCase() ?? "";
  const selectedVariables = state.analysisSelection.map((id) => state.variables.find((variable) => variable.id === id)).filter(Boolean);
  const variables = state.variables.filter((variable) => {
    if (query && !variable.label.toLowerCase().includes(query)) return false;
    if (selectedVariables.length !== 1 || state.analysisSelection.includes(variable.id)) return true;
    const first = selectedVariables[0];
    if (state.analysisGoal === "relationship") return first.kind === variable.kind && ["numeric", "categorical"].includes(first.kind);
    if (state.analysisGoal === "groups") return (
      (first.kind === "numeric" && variable.kind === "categorical") ||
      (first.kind === "categorical" && variable.kind === "numeric")
    );
    if (state.analysisGoal === "text") return (
      (first.kind === "text" && ["categorical", "numeric"].includes(variable.kind)) ||
      (["categorical", "numeric"].includes(first.kind) && variable.kind === "text")
    );
    return state.analysisGoal !== "overview";
  });
  const groups = new Map();
  variables.forEach((variable) => {
    const category = poolCategory(variable);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(variable);
  });
  $("#poolCount").textContent = `${variables.length} Datenpunkte`;
  $("#poolGroups").innerHTML = [...groups.entries()]
    .map(([category, items]) => {
      const open = state.openPoolGroups.has(category);
      return `
      <section class="pool-group ${open ? "open" : ""}" data-pool-group="${escapeHtml(category)}">
        <button class="pool-group-header"><span class="pool-chevron">›</span><span>${escapeHtml(category)}</span><span>${items.length}</span></button>
        <div class="pool-group-items ${open ? "" : "hidden"}">${items.map((variable) => {
          const selected = state.analysisSelection.includes(variable.id);
          const icon = variable.kind === "numeric" ? "123" : variable.kind === "text" ? "Aa" : "◫";
          return `<button class="pool-variable ${selected ? "selected" : ""}" data-id="${variable.id}">
            <span class="pool-variable-icon">${icon}</span><span><strong>${escapeHtml(shortened(variable.shortLabel, 72))}</strong><small>${escapeHtml(typeLabel(variable.sourceType))} · ${variable.kind}</small></span>
          </button>`;
        }).join("")}</div>
      </section>`;
    })
    .join("");
  $$(".pool-group-header").forEach((button) => {
    button.onclick = () => {
      const group = button.closest(".pool-group");
      const category = group.dataset.poolGroup;
      if (state.openPoolGroups.has(category)) state.openPoolGroups.delete(category);
      else state.openPoolGroups.add(category);
      group.classList.toggle("open");
      button.nextElementSibling.classList.toggle("hidden");
    };
  });
  $$(".pool-variable").forEach((button) => {
    button.onclick = () => selectAnalysisVariable(button.dataset.id);
  });
}

const goalExplanations = {
  relationship: {
    title: "Zusammenhänge verstehen",
    text: "Nutze dies, wenn du wissen möchtest, ob zwei Merkmale gemeinsam auftreten oder sich gemeinsam verändern. SPUT verwendet abhängig vom Datentyp eine Korrelation oder einen Verteilungstest.",
    example: "Beispiel: Steigt die Kaufwahrscheinlichkeit, wenn eine Produktidee besser bewertet wird? Oder hängt die bevorzugte Lösung mit dem Alter zusammen?",
  },
  groups: {
    title: "Gruppen vergleichen",
    text: "Nutze dies, wenn du einen Zahlenwert zwischen klaren Gruppen vergleichen möchtest. SPUT verwendet bei zwei Gruppen einen t-Test und bei mehr Gruppen eine ANOVA.",
    example: "Beispiel: Bewerten Teilnehmende aus Deutschland und den USA eine Idee unterschiedlich? Oder unterscheidet sich die mittlere Bewertung zwischen Altersgruppen?",
  },
  text: {
    title: "Freitext verstehen",
    text: "Nutze dies für offene Antworten. SPUT zeigt häufige Wörter und Themen und kann sie nach einer Gruppe oder einem Zahlenbereich aufteilen. Die Ergebnisse sind beschreibend und kein Signifikanztest.",
    example: "Beispiel: Welche Begriffe verwenden Männer und Frauen bei der Beschreibung von Premium-Service? Oder welche Themen nennen Personen mit hoher Bewertung?",
  },
  overview: {
    title: "Eine Variable beschreiben",
    text: "Nutze dies, wenn du zunächst nur eine Frage oder ein Merkmal verstehen möchtest. SPUT zeigt Häufigkeiten, Mittelwerte, Streuung oder eine gemeinsame Übersicht aller Optionen.",
    example: "Beispiel: Welche Haushaltslösung wird am häufigsten bevorzugt? Wie hoch ist die durchschnittliche Bewertung einer Idee?",
  },
};

function showGoalExplanation(goal) {
  state.openGoalInfo = state.openGoalInfo === goal ? null : goal;
  const element = $("#goalExplanation");
  if (!state.openGoalInfo) {
    element.classList.remove("visible");
    element.innerHTML = "";
    return;
  }
  const content = goalExplanations[state.openGoalInfo];
  element.innerHTML = `<span class="goal-info-icon">i</span><div><h4>${content.title}</h4><p>${content.text}<br><strong>${content.example}</strong></p></div>`;
  element.classList.add("visible");
}

function selectAnalysisVariable(id) {
  if (state.analysisSelection.includes(id)) {
    state.analysisSelection = state.analysisSelection.filter((value) => value !== id);
  } else if (state.analysisSelection.length < 2) {
    state.analysisSelection.push(id);
  } else {
    state.analysisSelection = [state.analysisSelection[1], id];
  }
  renderDataPool();
  renderGuidedSelection();
  syncExpertSelection();
}

function guidedRecommendation(selected) {
  if (!selected.length) return "Wähle links einen Datenpunkt aus. SPUT erklärt dir anschließend, welche Erkenntnisse möglich sind.";
  if (selected.length === 1) {
    const variable = selected[0];
    return `<strong>${escapeHtml(shortened(variable.label, 90))}</strong> wird einzeln beschrieben. Du erhältst Häufigkeiten, Mittelwerte oder zentrale Wörter – passend zum Datentyp.`;
  }
  const [a, b] = selected;
  const includesMultipleChoice = [a, b].some((variable) => variable.sourceType === "multiple_choice");
  if ([a.kind, b.kind].includes("complex")) return "<strong>Diese Frage enthält mehrere Antwortoptionen oder Items.</strong> Im geführten Modus wird sie als vollständige Frage ausgewertet. Entferne den zweiten Datenpunkt oder nutze im Expertenmodus eine klar gekennzeichnete Untervariable.";
  if (a.kind === "numeric" && b.kind === "numeric") return "<strong>Empfehlung: Zusammenhangsanalyse.</strong> SPUT misst Richtung und Stärke des Zusammenhangs und erklärt, was daraus abgeleitet werden darf.";
  if (a.kind === "categorical" && b.kind === "categorical" && includesMultipleChoice) return "<strong>Empfehlung: Auswahlmuster vergleichen.</strong> SPUT zeigt, welche Antworten gemeinsam gewählt werden und wie sich die Auswahlquoten zwischen Gruppen unterscheiden.";
  if (a.kind === "categorical" && b.kind === "categorical") return "<strong>Empfehlung: Verteilungsvergleich.</strong> SPUT prüft, ob die Merkmale systematisch zusammenhängen, und zeigt die Kombinationen als Kreuztabelle.";
  if ([a.kind, b.kind].includes("text")) return "<strong>Empfehlung: Segmentierte Textanalyse.</strong> SPUT zeigt, welche Wörter und Themen in den jeweiligen Gruppen häufiger vorkommen.";
  return "<strong>Empfehlung: Gruppenvergleich.</strong> SPUT prüft, ob sich der Zahlenwert zwischen den gewählten Gruppen unterscheidet.";
}

function availableGoals(selected) {
  if (!selected.length) return ["relationship", "groups", "text", "overview"];
  if (selected.length === 1) {
    if (selected[0].kind === "complex") return ["overview"];
    if (selected[0].kind === "text") return ["text", "overview"];
    return ["relationship", "groups", "text", "overview"];
  }
  const kinds = selected.map((variable) => variable.kind);
  if (kinds.includes("complex")) return [];
  if (kinds.every((kind) => kind === "numeric") || kinds.every((kind) => kind === "categorical")) return ["relationship"];
  if (kinds.includes("numeric") && kinds.includes("categorical")) return ["groups"];
  if (kinds.includes("text") && kinds.filter((kind) => kind === "text").length === 1) return ["text"];
  return [];
}

function plannedAnalysis(selected) {
  if (!selected.length) return null;
  if (selected.length === 1) {
    if (selected[0].kind === "text") return { name: "Themen- und Wortanalyse", detail: "Häufige Begriffe, Antwortlänge und Beispielantworten werden dargestellt.", button: "Freitext verständlich auswerten" };
    if (selected[0].kind === "complex") return { name: "Gemeinsame Fragenübersicht", detail: "Alle Optionen oder Items der Frage werden zusammen ausgewertet.", button: "Gesamte Frage verständlich auswerten" };
    if (selected[0].kind === "numeric") return { name: "Deskriptive Statistik", detail: "Mittelwert, Median, Streuung und Verteilung werden erklärt.", button: "Zahlenwert verständlich beschreiben" };
    return { name: "Häufigkeitsanalyse", detail: "Antwortverteilung und häufigste Ausprägungen werden erklärt.", button: "Antwortverteilung verständlich erklären" };
  }
  const [a, b] = selected;
  const includesMultipleChoice = [a, b].some((variable) => variable.sourceType === "multiple_choice");
  if (a.kind === "numeric" && b.kind === "numeric") return { name: "Korrelationsanalyse", detail: "Richtung und Stärke des Zusammenhangs werden berechnet und als Streudiagramm dargestellt.", button: "Zusammenhang berechnen und erklären" };
  if (a.kind === "categorical" && b.kind === "categorical" && includesMultipleChoice) return { name: "Auswahlmuster-Vergleich", detail: "SPUT vergleicht Auswahlquoten und prüft für einzelne Antwortpaare, ob sie häufiger gemeinsam auftreten.", button: "Auswahlmuster vergleichen und erklären" };
  if (a.kind === "categorical" && b.kind === "categorical") return { name: "Kreuztabelle + Chi-Quadrat", detail: "Verteilungen, statistische Signifikanz und Effektstärke werden geprüft.", button: "Verteilungszusammenhang prüfen und erklären" };
  if ([a.kind, b.kind].includes("text")) return { name: "Segmentierte Textanalyse", detail: "Wörter und Themen werden getrennt nach der zweiten Variable verglichen.", button: "Freitext nach Segmenten vergleichen" };
  return { name: "Gruppenvergleich", detail: "SPUT verwendet abhängig von der Gruppenzahl einen t-Test oder eine ANOVA und zeigt Mittelwerte mit Konfidenzintervallen.", button: "Gruppenunterschiede prüfen und erklären" };
}

function renderGuidedSelection() {
  if (!state.dataset) return;
  const selected = state.analysisSelection.map((id) => state.variables.find((variable) => variable.id === id)).filter(Boolean);
  const slot = (variable, index) =>
    variable
      ? `<div class="selection-slot filled"><strong>${escapeHtml(shortened(variable.label, 80))}</strong><small>${variable.kind === "numeric" ? "Zahlenwert / Skala" : variable.kind === "text" ? "Offene Antwort" : "Kategorie / Gruppe"}</small></div>`
      : `<div class="selection-slot">Datenpunkt ${index + 1}<small>Im Datenpool anklicken</small></div>`;
  $("#selectionSlots").innerHTML = `${slot(selected[0], 0)}<div class="selection-connector">${selected.length > 1 ? "↔" : "+"}</div>${slot(selected[1], 1)}`;
  const available = availableGoals(selected);
  if (!available.includes(state.analysisGoal)) state.analysisGoal = available[0] ?? "overview";
  $$("[data-goal]").forEach((button) => {
    const isAvailable = available.includes(button.dataset.goal);
    button.closest(".goal-option").classList.toggle("unavailable", !isAvailable);
    button.classList.toggle("active", button.dataset.goal === state.analysisGoal);
  });
  $("#assistantAdvice").innerHTML = guidedRecommendation(selected);
  const plan = plannedAnalysis(selected);
  $("#analysisPlan").classList.toggle("visible", Boolean(plan));
  $("#analysisPlan").innerHTML = plan ? `<span class="analysis-plan-badge">Geplant</span><span><strong>${plan.name}:</strong> ${plan.detail}</span>` : "";
  $("#runGuidedAnalysis").textContent = plan?.button ?? "Daten auswählen";
  $("#runGuidedAnalysis").disabled = selected.length === 0 || available.length === 0 || (selected.length > 1 && selected.some((variable) => variable.kind === "complex"));
}

function syncExpertSelection() {
  const [x, y] = state.analysisSelection;
  if (x && [...$("#variableX").options].some((option) => option.value === x)) $("#variableX").value = x;
  updateCompatibleVariables();
  if (y && [...$("#variableY").options].some((option) => option.value === y)) $("#variableY").value = y;
}

async function runGuidedAnalysis() {
  const selected = state.analysisSelection.map((id) => state.variables.find((variable) => variable.id === id)).filter(Boolean);
  const kinds = selected.map((variable) => variable.kind);
  if (selected.some((variable) => variable.kind === "complex")) $("#variableY").value = "";
  const method =
    state.analysisGoal === "groups" && kinds.includes("categorical") && kinds.includes("numeric")
      ? "group_compare"
      : state.analysisGoal === "text" && kinds.includes("text") && selected.length === 2
        ? "text_segment"
        : "auto";
  $("#analysisMethod").value = method;
  if (selected[0]) $("#variableX").value = selected[0].id;
  updateCompatibleVariables();
  if (selected.length === 1 || state.analysisGoal === "overview") $("#variableY").value = "";
  else if (selected[1] && [...$("#variableY").options].some((option) => option.value === selected[1].id)) $("#variableY").value = selected[1].id;
  const result = await runAnalysis();
  if (result) renderAssistantConclusion(result);
  $("#analysisResult").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAssistantConclusion(result) {
  let title = "Das ist die wichtigste Erkenntnis";
  let text = "";
  if (result.method === "crosstab") {
    text =
      result.pValue < 0.05
        ? `Die Verteilung unterscheidet sich zwischen den Gruppen. Der Zusammenhang ist nach Cramérs V ${result.cramersV < 0.1 ? "sehr klein" : result.cramersV < 0.3 ? "klein" : result.cramersV < 0.5 ? "mittel" : "groß"}.`
        : "In diesen Daten ist kein ausreichend klarer Zusammenhang zwischen den beiden Merkmalen erkennbar.";
  } else if (result.method === "multi_response") {
    const strongest = result.associations[0];
    text = strongest
      ? `Am deutlichsten treten „${strongest.aOption}“ und „${strongest.bOption}“ ${strongest.phi >= 0 ? "gemeinsam" : "seltener gemeinsam"} auf. Der paarweise Zusammenhang ist ${Math.abs(strongest.phi) < 0.1 ? "sehr klein" : Math.abs(strongest.phi) < 0.3 ? "klein" : Math.abs(strongest.phi) < 0.5 ? "mittel" : "groß"} (Phi ${strongest.phi.toFixed(2)}).`
      : "Die Auswahlquoten wurden miteinander verglichen. Es gibt kein Antwortpaar mit genügend gemeinsamen Beobachtungen für eine stabile hervorgehobene Aussage.";
  } else if (["pearson", "spearman"].includes(result.method)) {
    const strength = Math.abs(result.coefficient) < 0.3 ? "schwach" : Math.abs(result.coefficient) < 0.5 ? "mittel" : "stark";
    text = `Wenn der eine Wert steigt, ${result.coefficient < 0 ? "sinkt" : "steigt"} der andere tendenziell. Der Zusammenhang ist ${strength}. Daraus folgt noch keine Ursache.`;
  } else if (["ttest", "anova"].includes(result.method)) {
    const highest = result.groups.slice().sort((a, b) => b.mean - a.mean)[0];
    text =
      result.pValue < 0.05
        ? `Die Gruppen unterscheiden sich statistisch erkennbar. Den höchsten Durchschnitt hat „${highest.label}“ mit ${highest.mean.toFixed(2)}.`
        : `Die sichtbaren Gruppenunterschiede sind nicht eindeutig genug, um einen systematischen Unterschied anzunehmen. „${highest.label}“ hat zwar den höchsten Durchschnitt, dieser kann aber durch Zufallsschwankungen entstanden sein.`;
  } else if (result.method === "text_segment") {
    const examples = result.segments.slice(0, 3).map((segment) => `${segment.label}: ${segment.words.slice(0, 3).map((word) => word.label).join(", ")}`);
    text = `Die Gruppen verwenden teilweise unterschiedliche Begriffe. Besonders sichtbar sind: ${examples.join(" · ")}. Prüfe einzelne Antworten, bevor du daraus inhaltliche Schlüsse ziehst.`;
  } else if (result.method === "question_summary") {
    text = result.series?.length
      ? `Die Frage enthält ${result.series.length} gemeinsam ausgewertete Aussagen oder Optionen. Die Detaildarstellung darunter vergleicht sie innerhalb derselben Frage.`
      : `Die Antwortoptionen dieser Frage werden gemeinsam betrachtet. Am häufigsten wurde „${result.distribution?.[0]?.label ?? "keine Angabe"}“ ausgewählt.`;
  } else if (result.method === "text_overview") {
    const topWords = result.themes.slice(0, 3).map((theme) => theme.label).join(", ");
    text = `In ${result.n} Antworten wurden besonders häufig die Begriffe ${topWords || "keine stabilen Schlüsselbegriffe"} verwendet. Eine Antwort enthält durchschnittlich etwa ${result.averageWords.toFixed(1)} relevante Wörter. Die Beispiele sollten zusätzlich inhaltlich gelesen werden.`;
  } else {
    text = result.numeric
      ? `Der typische Wert liegt ungefähr bei ${result.numeric.median.toFixed(2)}; der Durchschnitt beträgt ${result.numeric.mean.toFixed(2)}.`
      : `Die häufigste Antwort ist „${result.distribution[0]?.label ?? "keine Angabe"}“.`;
  }
  const summary = document.createElement("div");
  summary.className = "assistant-conclusion";
  summary.innerHTML = `<span class="assistant-avatar">✦</span><div><span class="section-kicker">VERSTÄNDLICH ERKLÄRT</span><h3>${title}</h3><p>${escapeHtml(text)}</p></div>`;
  $("#analysisResult").prepend(summary);
}

function setAnalysisMode(mode) {
  state.analysisMode = mode;
  $$("[data-analysis-mode]").forEach((button) => button.classList.toggle("active", button.dataset.analysisMode === mode));
  $("#analysisWorkspace").classList.toggle("hidden", mode !== "guided");
  $("#expertBuilder").classList.toggle("hidden", mode !== "expert");
  $("#compatibilityBar").classList.toggle("hidden", mode !== "expert");
  $("#analysisHeading").textContent = mode === "guided" ? "Analyse-Assistent" : "Statistische Analyse";
  $("#analysisDescription").textContent =
    mode === "guided"
      ? "Wähle Daten aus. SPUT entscheidet, welche Auswertung sinnvoll ist, und erklärt das Ergebnis verständlich."
      : "Wähle Variablen, Testverfahren und Auswertungslogik selbst aus.";
}

function optionMarkup(variables, selected = "") {
  return variables.map((variable) =>
    `<option value="${variable.id}" ${variable.id === selected ? "selected" : ""}>${escapeHtml(shortened(variable.label, 100))}</option>`,
  ).join("");
}

function renderAnalysisVariables() {
  const variables = analysableVariables();
  const groupedOptions = [
    ["Fragen", variables.filter((variable) => variable.area === "Fragen")],
    ["Zielgruppe & Metadaten", variables.filter((variable) => variable.area !== "Fragen" && variable.area !== "Fragen · Untervariablen")],
    ["Untervariablen für Detailanalysen", variables.filter((variable) => variable.area === "Fragen · Untervariablen")],
  ];
  $("#variableX").innerHTML = groupedOptions
    .filter(([, items]) => items.length)
    .map(([label, items]) => `<optgroup label="${label}">${optionMarkup(items)}</optgroup>`)
    .join("");
  $("#variableX").onchange = updateCompatibleVariables;
  $("#analysisMethod").onchange = updateCompatibleVariables;
  updateCompatibleVariables();
}

function renderStudies() {
  const container = $("#studyGrid");
  if (!state.studies.length) {
    container.innerHTML = `<div class="study-empty"><span>◫</span><h3>Noch keine Studie geladen</h3><p>Importiere einen oder mehrere UserTesting-Exporte.</p></div>`;
    $("#combinePanel").classList.add("hidden");
    return;
  }
  container.innerHTML = state.studies
    .map((study) => {
      const selected = state.selectedStudies.has(study.id);
      return `<article class="study-card ${selected ? "selected" : ""}" data-study-id="${study.id}">
        <div class="study-card-top"><h3>${escapeHtml(study.dataset.name)}</h3><span class="study-select">${selected ? "✓" : ""}</span></div>
        <div class="study-meta"><span>${study.dataset.participants} Teilnehmende</span><span>${study.dataset.questions.length} Fragen</span>${study.dataset.countries.map((country) => `<span>${escapeHtml(country)}</span>`).join("")}${study.combined ? "<span>Kombiniert</span>" : ""}</div>
        <div class="study-card-actions"><small>${escapeHtml(study.dataset.fileName)}</small><span><button data-review-study="${study.id}">Fragen prüfen</button><button data-open-study="${study.id}">Öffnen →</button></span></div>
      </article>`;
    })
    .join("");
  $$(".study-card").forEach((card) => {
    card.onclick = (event) => {
      if (event.target.closest("[data-open-study]")) return;
      if (state.selectedStudies.has(card.dataset.studyId)) state.selectedStudies.delete(card.dataset.studyId);
      else state.selectedStudies.add(card.dataset.studyId);
      renderStudies();
    };
  });
  $$("[data-open-study]").forEach((button) => {
    button.onclick = () => {
      const study = state.studies.find((candidate) => candidate.id === button.dataset.openStudy);
      if (study) activateStudy(study);
    };
  });
  $$("[data-review-study]").forEach((button) => {
    button.onclick = async () => {
      const response = await fetch(`/api/datasets/${button.dataset.reviewStudy}`);
      const payload = await response.json();
      if (!response.ok) return toast(payload.error);
      const reviewed = await reviewImport(payload);
      if (!reviewed) return;
      const study = state.studies.find((candidate) => candidate.id === button.dataset.reviewStudy);
      if (study) {
        study.dataset = reviewed.dataset;
        study.summaries = reviewed.summaries;
      }
      if (study && state.datasetId === study.id) activateStudy(study);
      renderStudies();
    };
  });
  const selected = state.studies.filter((study) => state.selectedStudies.has(study.id));
  $("#combinePanel").classList.toggle("hidden", selected.length < 2);
  $("#combineDescription").textContent =
    selected.length >= 2
      ? `${selected.length} Studien mit insgesamt ${selected.reduce((sum, study) => sum + study.dataset.participants, 0)} Teilnehmenden werden über gleiche Fragen und Merkmale verbunden.`
      : "";
}

async function combineSelectedStudies() {
  const ids = [...state.selectedStudies];
  if (ids.length < 2) return;
  $("#loadingOverlay").classList.remove("hidden");
  try {
    const response = await fetch("/api/combine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, name: $("#combinedName").value.trim() || "Kombinierte Studie" }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error);
    const study = { id: payload.id, dataset: payload.dataset, summaries: payload.summaries, combined: true };
    state.studies.push(study);
    state.selectedStudies.clear();
    activateStudy(study);
    renderStudies();
    toast("Die Studien wurden kombiniert. Die Herkunft jedes Falls bleibt als Variable erhalten.");
  } catch (error) {
    toast(error.message);
  } finally {
    $("#loadingOverlay").classList.add("hidden");
  }
}

function methodCompatibility(method, x) {
  const candidates = state.expertVariables;
  if (!x) return [];
  if (method === "pearson" || method === "spearman") {
    return candidates.filter((variable) => variable.kind === "numeric" && variable.id !== x.id);
  }
  if (method === "crosstab") {
    return candidates.filter((variable) => variable.kind === "categorical" && variable.id !== x.id);
  }
  if (method === "group_compare") {
    const requiredKind = x.kind === "numeric" ? "categorical" : "numeric";
    if (!["numeric", "categorical"].includes(x.kind)) return [];
    return candidates.filter((variable) => variable.kind === requiredKind && variable.id !== x.id);
  }
  if (method === "text_segment") {
    if (x.kind === "text") {
      return candidates.filter((variable) => ["categorical", "numeric"].includes(variable.kind) && variable.id !== x.id);
    }
    if (["categorical", "numeric"].includes(x.kind)) {
      return candidates.filter((variable) => variable.kind === "text" && variable.id !== x.id);
    }
    return [];
  }
  return candidates.filter((variable) => {
    if (variable.id === x.id) return false;
    if (x.kind === "text") return ["categorical", "numeric"].includes(variable.kind);
    if (variable.kind === "text") return ["categorical", "numeric"].includes(x.kind);
    return ["categorical", "numeric"].includes(x.kind) && ["categorical", "numeric"].includes(variable.kind);
  });
}

function updateCompatibleVariables() {
  const method = $("#analysisMethod").value;
  const all = analysableVariables();
  let x = all.find((variable) => variable.id === $("#variableX").value);
  if (["pearson", "spearman"].includes(method) && x?.kind !== "numeric") {
    x = all.find((variable) => variable.kind === "numeric") ?? x;
    if (x) $("#variableX").value = x.id;
  }
  if (method === "crosstab" && x?.kind !== "categorical") {
    x = all.find((variable) => variable.kind === "categorical") ?? x;
    if (x) $("#variableX").value = x.id;
  }
  if (method === "group_compare" && !["numeric", "categorical"].includes(x?.kind)) {
    x = all.find((variable) => variable.kind === "categorical") ?? x;
    if (x) $("#variableX").value = x.id;
  }
  if (method === "text_segment" && !["text", "numeric", "categorical"].includes(x?.kind)) {
    x = all.find((variable) => variable.kind === "text") ?? x;
    if (x) $("#variableX").value = x.id;
  }
  const previousY = $("#variableY").value;
  const compatible = methodCompatibility(method, x);
  $("#variableY").innerHTML =
    `<option value="">Keine – nur ${x?.kind === "text" ? "Textübersicht" : "deskriptive Analyse"}</option>` +
    optionMarkup(compatible, previousY);
  const actualMethod = method === "auto" ? "Automatische Testauswahl" : {
    pearson: "Pearson-Korrelation",
    spearman: "Spearman-Korrelation",
    crosstab: "Kreuztabelle + Chi-Quadrat",
    group_compare: "t-Test / ANOVA",
    text_segment: "Segmentierte Textanalyse",
  }[method];
  $("#compatibilityText").textContent = x
    ? `${actualMethod}: ${compatible.length} passende Variablen für „${shortened(x.label, 65)}“ verfügbar.`
    : "Keine analysierbare Variable vorhanden.";
}

async function runAnalysis() {
  const button = $("#runAnalysis");
  button.disabled = true;
  button.textContent = "Berechne …";
  try {
    const xVariable = state.expertVariables.find((variable) => variable.id === $("#variableX").value);
    const yVariable = state.expertVariables.find((variable) => variable.id === $("#variableY").value);
    const response = await fetch(`/api/datasets/${state.datasetId}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        x: $("#variableX").value,
        y: $("#variableY").value,
        method: $("#analysisMethod").value,
        xKind: xVariable?.kind,
        yKind: yVariable?.kind,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    renderAnalysisResult(result);
    return result;
  } catch (error) {
    toast(error.message);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = "Auswerten";
  }
}

function exportAnalysisPng() {
  const source = state.analysisChart?.canvas;
  if (!source) return;
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0);
  const link = document.createElement("a");
  link.download = `SPUT_Analyse_${new Date().toISOString().slice(0, 10)}.png`;
  link.href = output.toDataURL("image/png");
  link.click();
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.download = filename;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportResultTable() {
  const result = state.currentAnalysis;
  if (!result) return;
  let rows = [];
  if (result.method === "crosstab") {
    rows = [[result.x.label, ...result.columns, "Gesamt"]];
    result.rows.forEach((row, index) => rows.push([row, ...result.matrix[index], result.matrix[index].reduce((sum, value) => sum + value, 0)]));
    rows.push([]);
    rows.push(["Chi-Quadrat", result.statistic], ["Freiheitsgrade", result.degreesOfFreedom], ["p-Wert", result.pValue], ["Cramérs V", result.cramersV]);
  } else if (result.method === "multi_response") {
    rows = [[result.x.label, ...result.columns.map((column, index) => `${column} (Basis N=${result.bases[index]})`)]];
    result.rows.forEach((row, rowIndex) =>
      rows.push([row, ...result.matrix[rowIndex].map((count, columnIndex) => `${count} (${(result.rates[rowIndex][columnIndex] * 100).toFixed(1)} %)`)]),
    );
    rows.push([], ["Antwort A", "Antwort B", "Gemeinsam gewählt", "Phi", "p-Wert"]);
    result.associations.forEach((item) => rows.push([item.aOption, item.bOption, item.both, item.phi, item.pValue]));
  } else if (["ttest", "anova"].includes(result.method)) {
    rows = [["Gruppe", "N", "Mittelwert", "Median", "Standardabweichung", "CI 95% unten", "CI 95% oben"]];
    result.groups.forEach((group) => rows.push([group.label, group.n, group.mean, group.median, group.standardDeviation, group.ciLow, group.ciHigh]));
    rows.push([]);
    rows.push(["Test", result.method], ["Statistik", result.statistic], ["p-Wert", result.pValue], ["Effektstärke", result.effectSize]);
  }
  if (rows.length) downloadCsv(`SPUT_Tabelle_${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function resultActions(coefficient = "", includeTable = false) {
  return `<div class="result-actions">${coefficient}${includeTable ? '<button class="export-button" id="exportTable">↓ Tabelle als CSV</button>' : ""}<button class="export-button" id="exportAnalysis">↓ Diagramm als PNG</button></div>`;
}

function bindResultExports(includeTable = false) {
  const imageButton = $("#exportAnalysis");
  if (imageButton) imageButton.onclick = exportAnalysisPng;
  const tableButton = $("#exportTable");
  if (includeTable && tableButton) tableButton.onclick = exportResultTable;
}

function pLabel(value) {
  return value < 0.001 ? "< 0,001" : value.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function significanceText(pValue) {
  return pValue < 0.05
    ? "Das Ergebnis ist auf dem üblichen 5-%-Niveau statistisch signifikant. Das bedeutet nicht automatisch, dass der Effekt praktisch groß oder kausal ist."
    : "Das Ergebnis ist auf dem üblichen 5-%-Niveau nicht statistisch signifikant. Die Daten liefern damit keinen ausreichenden Nachweis für einen systematischen Unterschied oder Zusammenhang.";
}

function correlationInfo(method) {
  return `<div class="info-box"><span class="info-icon">i</span><div><strong>So wird die Korrelation interpretiert</strong><p>${method === "pearson" ? "Pearson misst einen linearen Zusammenhang zwischen zwei quantitativen Variablen." : "Spearman misst einen monotonen Zusammenhang anhand der Rangfolge und ist robuster gegenüber Ausreißern."} Der Koeffizient liegt zwischen −1 und +1. Das Vorzeichen zeigt die Richtung; als grobe Orientierung gelten |r| &lt; 0,3 als schwach, 0,3–0,5 als mittel und &gt; 0,5 als stark. Eine Korrelation beweist keine Ursache-Wirkungs-Beziehung.</p></div></div>`;
}

function renderAnalysisResult(result) {
  const container = $("#analysisResult");
  state.analysisChart = null;
  state.currentAnalysis = result;
  if (result.method === "text_overview") {
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">FREITEXTAUSWERTUNG · N = ${result.n}</span><h3>${escapeHtml(result.x.label)}</h3><p>Themen, Worthäufigkeiten und alle Originalantworten</p></div>${result.themes.length ? resultActions() : ""}</div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>Wie wird Freitext hier ausgewertet?</strong><p>SPUT zählt relevante Begriffe pro Antwort und zeigt häufige Wörter sowie Originalbeispiele. Zahlen innerhalb eines Satzes werden nicht als Messwerte behandelt. Die Auswertung ist beschreibend und versteht noch keine Verneinungen, Synonyme oder Ironie.</p></div></div>
      <div class="stat-grid">
        <div class="stat-card"><span>Antworten</span><strong>${result.n}</strong><small>gültige Freitexte</small></div>
        <div class="stat-card"><span>Ø relevante Wörter</span><strong>${result.averageWords.toFixed(1)}</strong><small>pro Antwort</small></div>
        <div class="stat-card"><span>Schlüsselbegriffe</span><strong>${result.themes.length}</strong><small>im Diagramm</small></div>
      </div>
      <div class="text-overview-grid">
        <div><h4 class="result-subheading">Häufige Begriffe</h4><p class="text-analysis-caution">Hinweis: Die automatische Wortanalyse kann Fehler enthalten und erkennt weder Kontext, Synonyme, Verneinungen noch Ironie zuverlässig.</p><div class="analysis-chart"><canvas></canvas></div></div>
        <div><h4 class="result-subheading">Alle Originalantworten <span class="answer-count">${result.answers.length}</span></h4><div class="text-samples text-samples-all">${result.answers.map((answer, index) => `<div class="text-sample"><strong>${index + 1}</strong>${escapeHtml(answer)}</div>`).join("")}</div></div>
      </div>`;
    if (result.themes.length) {
      state.analysisChart = chart(container.querySelector("canvas"), {
        type: "bar",
        data: { labels: result.themes.map((theme) => theme.label), datasets: [{ data: result.themes.map((theme) => theme.count), backgroundColor: PRIMARY, borderRadius: 5 }] },
        options: { maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
      });
      bindResultExports();
    }
    return;
  }
  if (result.method === "question_summary") {
    const distribution = result.series
      ? result.series.map((item) => ({ label: item.label, value: item.numeric?.mean ?? item.distribution?.[0]?.count ?? 0 }))
      : (result.distribution ?? []).map((item) => ({ label: item.label, value: item.count }));
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">GESAMTE FRAGE</span><h3>${escapeHtml(result.x.label)}</h3><p>${result.series ? `${result.series.length} Aussagen oder Optionen gemeinsam ausgewertet` : "Auswahlhäufigkeiten über alle Antwortoptionen"}</p></div>${resultActions()}</div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>Warum wird die Frage gemeinsam dargestellt?</strong><p>Die einzelnen Exportspalten gehören fachlich zu derselben Frage. SPUT fasst sie deshalb in einer gemeinsamen Auswertung zusammen. Einzelne Items stehen ausschließlich im Expertenmodus für gezielte Detailtests zur Verfügung.</p></div></div>
      <div class="analysis-chart tall"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "bar",
      data: { labels: distribution.map((item) => item.label), datasets: [{ data: distribution.map((item) => item.value), backgroundColor: PRIMARY, borderRadius: 6 }] },
      options: { maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true }, y: { grid: { display: false } } } },
    });
    bindResultExports();
    return;
  }
  if (result.method === "multi_response") {
    const strongest = result.associations[0];
    const strength = strongest
      ? Math.abs(strongest.phi) < 0.1 ? "sehr klein" : Math.abs(strongest.phi) < 0.3 ? "klein" : Math.abs(strongest.phi) < 0.5 ? "mittel" : "groß"
      : "nicht bestimmbar";
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">AUSWAHLMUSTER · N = ${result.n}</span><h3>${escapeHtml(result.x.label)} × ${escapeHtml(result.y.label)}</h3><p>Gemeinsame Antworten und Auswahlquoten nach der zweiten Variable</p></div>${resultActions("", true)}</div>
      <div class="stat-grid">
        <div class="stat-card"><span>Gültige Fälle</span><strong>${result.n}</strong><small>mit Angaben in beiden Fragen</small></div>
        <div class="stat-card"><span>Antwortpaare</span><strong>${result.rows.length * result.columns.length}</strong><small>einzeln verglichen</small></div>
        <div class="stat-card"><span>Stärkstes Phi</span><strong>${strongest ? strongest.phi.toFixed(3) : "—"}</strong><small>${strength}er Zusammenhang</small></div>
      </div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>Wie wird der Auswahlmuster-Vergleich interpretiert?</strong><p>Jede Zelle zeigt, wie oft zwei Antworten von derselben Person gewählt wurden. Der Prozentwert bezieht sich auf alle Personen in der jeweiligen Spalte. Phi prüft jedes Antwortpaar als Ja/Nein-Zusammenhang: positive Werte bedeuten häufigeres gemeinsames Auftreten, negative Werte selteneres gemeinsames Auftreten. Bei Mehrfachauswahl sind mehrere Antworten derselben Person erlaubt; deshalb summieren sich Prozentwerte nicht zwingend zu 100 %. Viele paarweise Tests erhöhen außerdem die Wahrscheinlichkeit zufälliger Treffer.</p></div></div>
      <div style="overflow:auto"><table class="cross-table"><thead><tr><th>${escapeHtml(result.x.label)}</th>${result.columns.map((column, index) => `<th>${escapeHtml(column)}<small>Basis N=${result.bases[index]}</small></th>`).join("")}</tr></thead>
      <tbody>${result.rows.map((row, rowIndex) => `<tr><td>${escapeHtml(row)}</td>${result.matrix[rowIndex].map((value, columnIndex) => `<td>${value}<small>${(result.rates[rowIndex][columnIndex] * 100).toFixed(1)} %</small></td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${result.associations.length ? `<h4 class="result-subheading">Auffällige Antwortpaare</h4><table class="group-table"><thead><tr><th>Antwort aus Frage 1</th><th>Antwort aus Frage 2</th><th>Gemeinsam</th><th>Phi</th><th>p-Wert</th></tr></thead><tbody>${result.associations.slice(0, 8).map((item) => `<tr><td>${escapeHtml(item.aOption)}</td><td>${escapeHtml(item.bOption)}</td><td>${item.both}</td><td>${item.phi.toFixed(3)}</td><td>${pLabel(item.pValue)}</td></tr>`).join("")}</tbody></table>` : ""}
      <h4 class="result-subheading">Auswahlquote nach ${escapeHtml(result.y.label)}</h4><div class="analysis-chart tall"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "bar",
      data: {
        labels: result.rows,
        datasets: result.columns.map((column, columnIndex) => ({
          label: column,
          data: result.rates.map((row) => row[columnIndex] * 100),
          backgroundColor: colors[columnIndex % colors.length],
          borderRadius: 4,
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.raw.toFixed(1)} %` } },
        },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, max: 100, title: { display: true, text: "Auswahlquote in %" } } },
      },
    });
    bindResultExports(true);
    return;
  }
  if (result.method === "crosstab") {
    const vInterpretation = result.cramersV < 0.1 ? "sehr klein" : result.cramersV < 0.3 ? "klein" : result.cramersV < 0.5 ? "mittel" : "groß";
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">KREUZTABELLE · N = ${result.n}</span><h3>${escapeHtml(result.x.label)} × ${escapeHtml(result.y.label)}</h3><p>Absolute Häufigkeiten und Unabhängigkeitstest</p></div>${resultActions("", true)}</div>
      <div class="stat-grid">
        <div class="stat-card"><span>Chi-Quadrat</span><strong>${result.statistic.toFixed(2)}</strong><small>df = ${result.degreesOfFreedom}</small></div>
        <div class="stat-card"><span>p-Wert</span><strong>${pLabel(result.pValue)}</strong><small>${result.pValue < 0.05 ? "statistisch signifikant" : "nicht signifikant"}</small></div>
        <div class="stat-card"><span>Cramérs V</span><strong>${result.cramersV.toFixed(3)}</strong><small>${vInterpretation}e Effektstärke</small></div>
      </div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>Was bedeuten Chi-Quadrat und Cramérs V?</strong><p>Der Chi-Quadrat-Test prüft, ob die Verteilung der zweiten Variable von der ersten Variable unabhängig ist. ${significanceText(result.pValue)} Cramérs V beschreibt zusätzlich die Stärke des Zusammenhangs unabhängig von der Stichprobengröße. ${result.lowExpectedCells ? `${result.lowExpectedCells} von ${result.totalCells} erwarteten Zellen liegen unter 5; das Ergebnis sollte daher vorsichtig interpretiert werden.` : ""}</p></div></div>
      <div style="overflow:auto"><table class="cross-table"><thead><tr><th>${escapeHtml(result.x.label)}</th>${result.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
      <tbody>${result.rows.map((row, rowIndex) => `<tr><td>${escapeHtml(row)}</td>${result.matrix[rowIndex].map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <h4 class="result-subheading">Verteilung nach ${escapeHtml(result.y.label)}</h4><div class="analysis-chart tall"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "bar",
      data: {
        labels: result.rows,
        datasets: result.columns.map((column, columnIndex) => ({
          label: column,
          data: result.matrix.map((row) => row[columnIndex]),
          backgroundColor: colors[columnIndex % colors.length],
          borderRadius: 4,
        })),
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    bindResultExports(true);
    return;
  }
  if (["pearson", "spearman"].includes(result.method)) {
    const coefficient = `<div class="coefficient"><strong>${result.coefficient.toFixed(3)}</strong><span>Korrelationskoeffizient</span></div>`;
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">${result.method.toUpperCase()} · N = ${result.n}</span><h3>${escapeHtml(result.x.label)} × ${escapeHtml(result.y.label)}</h3><p>${Math.abs(result.coefficient) > .7 ? "Starker" : Math.abs(result.coefficient) > .4 ? "Mittlerer" : "Schwacher"} ${result.coefficient < 0 ? "negativer" : "positiver"} Zusammenhang</p></div>
      ${resultActions(coefficient)}</div>${correlationInfo(result.method)}<div class="analysis-chart"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "scatter",
      data: { datasets: [{ data: result.points, backgroundColor: PRIMARY_RGBA, pointRadius: 5 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { title: { display: true, text: result.x.label } }, y: { title: { display: true, text: result.y.label } } },
      },
    });
    bindResultExports();
    return;
  }
  if (["ttest", "anova"].includes(result.method)) {
    const effectName = result.method === "ttest" ? "Cohen’s d" : "Eta²";
    const effectAbsolute = Math.abs(result.effectSize);
    const effectText = effectAbsolute < 0.2 ? "klein" : effectAbsolute < 0.5 ? "eher klein" : effectAbsolute < 0.8 ? "mittel" : "groß";
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">${result.method === "ttest" ? "WELCH-t-TEST" : "EINFAKTORIELLE ANOVA"}</span><h3>${escapeHtml(result.numeric.label)} nach ${escapeHtml(result.category.label)}</h3><p>${result.groups.length} Gruppen · ${result.groups.reduce((sum, group) => sum + group.n, 0)} gültige Werte</p></div>${resultActions("", true)}</div>
      <div class="stat-grid">
        <div class="stat-card"><span>${result.method === "ttest" ? "t-Wert" : "F-Wert"}</span><strong>${result.statistic.toFixed(2)}</strong><small>${result.method === "ttest" ? `df = ${result.degreesOfFreedom.toFixed(1)}` : `df = ${result.dfBetween}; ${result.dfWithin}`}</small></div>
        <div class="stat-card"><span>p-Wert</span><strong>${pLabel(result.pValue)}</strong><small>${result.pValue < 0.05 ? "statistisch signifikant" : "nicht signifikant"}</small></div>
        <div class="stat-card"><span>${effectName}</span><strong>${result.effectSize.toFixed(3)}</strong><small>${effectText}e Effektstärke</small></div>
      </div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>${result.method === "ttest" ? "Wie wird der t-Test interpretiert?" : "Wie wird die ANOVA interpretiert?"}</strong><p>${result.method === "ttest" ? "Der Welch-t-Test vergleicht die Mittelwerte zweier unabhängiger Gruppen und setzt keine gleichen Varianzen voraus." : "Die ANOVA prüft, ob sich mindestens ein Gruppenmittelwert von den anderen unterscheidet. Sie zeigt ohne Post-hoc-Test nicht, welche konkreten Gruppen verschieden sind."} ${significanceText(result.pValue)} Die Effektstärke beschreibt, wie relevant der Unterschied praktisch ist.</p></div></div>
      <table class="group-table"><thead><tr><th>Gruppe</th><th>N</th><th>Mittelwert</th><th>Median</th><th>SD</th><th>95-%-KI</th></tr></thead><tbody>${result.groups.map((group) => `<tr><td>${escapeHtml(group.label)}</td><td>${group.n}</td><td>${group.mean.toFixed(2)}</td><td>${group.median.toFixed(2)}</td><td>${group.standardDeviation.toFixed(2)}</td><td>${group.ciLow.toFixed(2)}–${group.ciHigh.toFixed(2)}</td></tr>`).join("")}</tbody></table>
      <h4 class="result-subheading">Mittelwerte nach Gruppe</h4><div class="analysis-chart"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "bar",
      data: { labels: result.groups.map((group) => group.label), datasets: [{ label: "Mittelwert", data: result.groups.map((group) => group.mean), backgroundColor: result.groups.map((_, index) => colors[index % colors.length]), borderRadius: 6 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (context) => `95-%-KI: ${result.groups[context.dataIndex].ciLow.toFixed(2)}–${result.groups[context.dataIndex].ciHigh.toFixed(2)}` } } },
        scales: { y: { beginAtZero: true }, x: { grid: { display: false } } },
      },
    });
    bindResultExports(true);
    return;
  }
  if (result.method === "text_segment") {
    const allWords = [...new Set(result.segments.flatMap((segment) => segment.words.map((word) => word.label)))].slice(0, 12);
    container.innerHTML = `
      <div class="result-header"><div><span class="section-kicker">SEGMENTIERTE TEXTANALYSE</span><h3>${escapeHtml(result.text.label)}</h3><p>Aufgeschlüsselt nach ${escapeHtml(result.segment.label)}</p></div>${resultActions()}</div>
      <div class="info-box"><span class="info-icon">i</span><div><strong>Wie wird diese Übersicht interpretiert?</strong><p>Die Darstellung zählt, in wie vielen Antworten ein Wort mindestens einmal vorkommt. Sie beschreibt sprachliche Unterschiede zwischen Segmenten, ist aber kein Signifikanztest und berücksichtigt noch keine Synonyme, Verneinungen oder den Kontext eines Wortes.</p></div></div>
      <div class="text-segment-grid">${result.segments.map((segment, index) => `<article class="text-segment"><h4>${escapeHtml(segment.label)} <span>N = ${segment.n}</span></h4><div class="word-bars">${segment.words.map((word) => `<div class="word-row"><span>${escapeHtml(word.label)}</span><i style="width:${Math.max(6, (word.count / Math.max(...segment.words.map((item) => item.count))) * 100)}%;background:${colors[index % colors.length]}"></i><strong>${word.count}</strong></div>`).join("")}</div></article>`).join("")}</div>
      <h4 class="result-subheading">Worthäufigkeiten im Segmentvergleich</h4><p class="text-analysis-caution">Hinweis: Die automatische Wortanalyse kann Fehler enthalten und erkennt weder Kontext, Synonyme, Verneinungen noch Ironie zuverlässig.</p><div class="analysis-chart tall"><canvas></canvas></div>`;
    state.analysisChart = chart(container.querySelector("canvas"), {
      type: "bar",
      data: {
        labels: allWords,
        datasets: result.segments.map((segment, index) => ({
          label: segment.label,
          data: allWords.map((word) => segment.words.find((item) => item.label === word)?.count ?? 0),
          backgroundColor: colors[index % colors.length],
          borderRadius: 3,
        })),
      },
      options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
    });
    bindResultExports();
    return;
  }
  const distribution = result.distribution.slice(0, 25);
  container.innerHTML = `
    <div class="result-header"><div><span class="section-kicker">DESKRIPTIVE STATISTIK</span><h3>${escapeHtml(result.x.label)}</h3><p>${result.numeric ? `Mittelwert ${result.numeric.mean.toFixed(2)} · Median ${result.numeric.median.toFixed(2)} · SD ${result.numeric.standardDeviation.toFixed(2)}` : `${distribution.reduce((sum, item) => sum + item.count, 0)} gültige Antworten`}</p></div>
    ${resultActions()}</div><div class="analysis-chart"><canvas></canvas></div>`;
  state.analysisChart = chart(container.querySelector("canvas"), {
    type: "bar",
    data: { labels: distribution.map((item) => item.label), datasets: [{ data: distribution.map((item) => item.count), backgroundColor: PRIMARY, borderRadius: 7 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });
  $("#exportAnalysis").onclick = exportAnalysisPng;
}

let viewTransitionTimer = null;

function activateView(view) {
  $$(".view").forEach((element) => element.classList.remove("active"));
  $$(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $(`#${view}View`).classList.add("active");
  const helpMode = view === "help";
  $(".nav").classList.toggle("help-mode", helpMode);
  $("#helpOutline").classList.toggle("hidden", !helpMode);
  $("#pageTitle").textContent = { dashboard: "Übersicht", data: "Daten", analysis: "Analysieren", interactive: "Interaktiv", studies: "Studien", help: "Anleitung" }[view];
  if (view === "studies") renderStudies();
  if (view === "interactive" && state.dataset) renderInteractiveDashboard();
  if (view === "analysis" && state.dataset) {
    renderDataPool();
    renderGuidedSelection();
  }
}

function changeView(view) {
  const nextView = $(`#${view}View`);
  const currentView = $(".view.active");
  if (!nextView || currentView === nextView) return;
  if (viewTransitionTimer) window.clearTimeout(viewTransitionTimer);
  currentView.classList.remove("view-enter");
  currentView.classList.add("view-leave");
  viewTransitionTimer = window.setTimeout(() => {
    currentView.classList.remove("active", "view-leave");
    activateView(view);
    nextView.classList.add("view-enter");
    window.setTimeout(() => nextView.classList.remove("view-enter"), 220);
    viewTransitionTimer = null;
  }, 130);
}

function openHelp() {
  changeView("help");
}

function closeHelp() {
  if ($("#helpView").classList.contains("active")) changeView("dashboard");
}

applyTheme(state.settings.themeMode);
initSidebarResize();
$("#fileInput").addEventListener("change", (event) => importFiles(event.target.files));
$("#newImport").addEventListener("click", () => $("#fileInput").click());
$("#runAnalysis").addEventListener("click", runAnalysis);
$("#runGuidedAnalysis").addEventListener("click", runGuidedAnalysis);
$("#poolSearch").addEventListener("input", renderDataPool);
$("#openAiExport").addEventListener("click", openAiExportDialog);
$(".icon-button[title='Hilfe']").addEventListener("click", () => {
  if ($("#helpView").classList.contains("active")) closeHelp();
  else openHelp();
});
$("#closeHelp").addEventListener("click", closeHelp);
$$('[data-help-section]').forEach((button) => button.addEventListener("click", () => {
  const section = document.getElementById(button.dataset.helpSection);
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
}));
$("#closeAiExport").addEventListener("click", closeAiExportDialog);
$("#downloadAiJson").addEventListener("click", downloadAiExport);
$("#downloadAiMarkdown").addEventListener("click", downloadAiMarkdown);
$("#closeInteractiveDetail").addEventListener("click", closeInteractiveDetail);
$("#interactiveDetailOverlay").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeInteractiveDetail();
});
$("#clearInteractiveFilters").addEventListener("click", () => {
  resetInteractiveView();
});
$("#loadInteractiveView").addEventListener("click", openLoadViewDialog);
$("#saveInteractiveView").addEventListener("click", openSaveViewDialog);
$("#closeSaveView").addEventListener("click", closeSaveViewDialog);
$("#cancelSaveView").addEventListener("click", closeSaveViewDialog);
$("#confirmSaveView").addEventListener("click", saveInteractiveView);
$("#closeLoadView").addEventListener("click", closeLoadViewDialog);
$("#openSettings").addEventListener("click", openSettingsDialog);
$("#closeSettings").addEventListener("click", closeSettingsDialog);
$("#viewStorageMode").addEventListener("change", (event) => updateStorageMode(event.target.value));
$("#themeMode").addEventListener("change", (event) => updateThemeMode(event.target.checked));
$("#externalViewInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    applySavedView(JSON.parse(await file.text()));
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
});
$("#clearAnalysisSelection").addEventListener("click", () => {
  state.analysisSelection = [];
  renderDataPool();
  renderGuidedSelection();
});
$$("[data-analysis-mode]").forEach((button) => button.addEventListener("click", () => setAnalysisMode(button.dataset.analysisMode)));
$$("[data-goal]").forEach((button) =>
  button.addEventListener("click", () => {
    state.analysisGoal = button.dataset.goal;
    $$("[data-goal]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    renderDataPool();
    renderGuidedSelection();
  }),
);
$$("[data-goal-info]").forEach((button) =>
  button.addEventListener("click", () => showGoalExplanation(button.dataset.goalInfo)),
);
$("#combineStudies").addEventListener("click", combineSelectedStudies);
$$(".nav-item").forEach((button) => button.addEventListener("click", () => !button.disabled && changeView(button.dataset.view)));
renderStudies();
setAnalysisMode("guided");

const reviewDatasetId = new URLSearchParams(window.location.search).get("review");
if (reviewDatasetId) {
  fetch(`/api/datasets/${reviewDatasetId}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      return reviewImport(payload);
    })
    .catch((error) => toast(error.message));
}
