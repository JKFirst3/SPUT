import { Country, State } from "country-state-city";

const COUNTRY_ALIASES = new Map([
  ["Deutschland", "DE"],
  ["Germany", "DE"],
  ["Vereinigte Staaten von Amerika", "US"],
  ["United States", "US"],
  ["USA", "US"],
  ["Australien", "AU"],
  ["Australia", "AU"],
  ["Niederlande", "NL"],
  ["Netherlands", "NL"],
  ["Vereinigtes Königreich", "GB"],
  ["United Kingdom", "GB"],
  ["Dänemark", "DK"],
  ["Denmark", "DK"],
]);
const WORLD_NAMES = new Map([
  ["DE", "Germany"],
  ["US", "United States of America"],
  ["AU", "Australia"],
  ["NL", "Netherlands"],
  ["GB", "United Kingdom"],
  ["DK", "Denmark"],
]);
const REGION_ALIASES = new Map([
  ["Kalifornien", "California"],
  ["Bayern", "Bavaria"],
  ["Niedersachsen", "Lower Saxony"],
  ["Nordrhein-Westfalen", "North Rhine-Westphalia"],
  ["Hessen", "Hesse"],
  ["Sachsen", "Saxony"],
  ["Sachsen-Anhalt", "Saxony-Anhalt"],
  ["Thüringen", "Thuringia"],
  ["Rheinland-Pfalz", "Rhineland-Palatinate"],
  ["Baden-Württemberg", "Baden-Wurttemberg"],
  ["Mecklenburg-Vorpommern", "Mecklenburg-Vorpommern"],
  ["Schleswig-Holstein", "Schleswig-Holstein"],
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function geographyForDataset(dataset) {
  const countryColumn = dataset.metadata.find((column) => /^(Land|Country)$/i.test(column.label));
  if (!countryColumn) return [];
  const regionColumns = dataset.metadata.filter((column) => column.label.startsWith("Region –"));
  const groups = new Map();

  for (const record of dataset.records) {
    const countryName = record[countryColumn.key];
    if (!countryName || countryName === "—") continue;
    const countryCode =
      COUNTRY_ALIASES.get(countryName) ??
      Country.getAllCountries().find((country) => normalize(country.name) === normalize(countryName))?.isoCode;
    if (!countryCode) continue;
    const regionColumn =
      regionColumns.find((column) => record[column.key] && record[column.key] !== "—") ??
      regionColumns.find((column) => normalize(column.label).includes(normalize(countryName)));
    const regionName = regionColumn ? record[regionColumn.key] : "";
    const regionLookupName = REGION_ALIASES.get(regionName) ?? regionName;
    const key = `${countryCode}:${regionName || "unknown"}`;
    if (!groups.has(key)) {
      const states = State.getStatesOfCountry(countryCode);
      const state = states.find(
        (candidate) =>
          normalize(candidate.name) === normalize(regionName) ||
          normalize(candidate.name) === normalize(regionLookupName) ||
          normalize(candidate.isoCode) === normalize(regionName),
      );
      const country = Country.getCountryByCode(countryCode);
      groups.set(key, {
        countryCode,
        worldCountryName: WORLD_NAMES.get(countryCode) ?? country?.name,
        countryName,
        region: regionName || "Keine Regionsangabe",
        latitude: Number(state?.latitude ?? country?.latitude),
        longitude: Number(state?.longitude ?? country?.longitude),
        count: 0,
      });
    }
    groups.get(key).count += 1;
  }
  return [...groups.values()].filter(
    (entry) => Number.isFinite(entry.latitude) && Number.isFinite(entry.longitude),
  );
}
