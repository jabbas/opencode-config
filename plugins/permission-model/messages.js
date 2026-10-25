// User/agent-facing messages (spec §4.6a). The message goes to the model (and the system notification),
// not into the permission dialog. Templates are fixed Polish strings — see Task 6 brief.

const PREFIX = "permission-model: "

/** Target class -> label used in messages. */
const CLS_LABEL = { dev: "dev", home: "home", prod: "prod", unknown: "nieznany", local: "lokalnie" }

export const clsLabel = (cls) => CLS_LABEL[cls] ?? "nieznany"

/** Cut to 60 characters (verbs can carry long argument text). */
export const clip = (s, n = 60) => {
  const t = String(s ?? "")
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

const where = (kind, name) => [kind, name].filter((x) => x !== undefined && x !== null && x !== "").join(" ")

const toolVerb = (tool, verb) => [tool, clip(verb)].filter((x) => x !== undefined && x !== null && x !== "").join(" ")

/** `zapis na {cls_celu} ({kind} {name}): {tool} {verb} — wymaga zgody` */
export const writeAsk = ({ cls, kind, name, tool, verb }) =>
  `${PREFIX}zapis na ${clsLabel(cls)} (${where(kind, name)}): ${toolVerb(tool, verb)} — wymaga zgody`

/** `operacja nieodwracalna na {kind} {name} ({cls_celu}): {tool} {verb}` */
export const irreversible = ({ cls, kind, name, tool, verb }) =>
  `${PREFIX}operacja nieodwracalna na ${where(kind, name)} (${clsLabel(cls)}): ${toolVerb(tool, verb)}`

export const OPAQUE_REASONS = {
  context: "zmiana kontekstu w tej samej komendzie",
  variable: "zmienna w komendzie",
  tmpScript: "skrypt z tmp",
}

/** `cel nieznany ({powód}) — podaj cel dosłownie` */
export const unknownTarget = (reason) => `${PREFIX}cel nieznany (${reason}) — podaj cel dosłownie`

/** `dane wrażliwe: {ścieżka|komenda}` */
export const secretAsk = (what) => `${PREFIX}dane wrażliwe: ${clip(what, 120)}`

/** `twardy zakaz — dane wrażliwe: {…}` */
export const secretDeny = (what) => `${PREFIX}twardy zakaz — dane wrażliwe: ${clip(what, 120)}`

/** `zapis własnej konfiguracji: {ścieżka}` */
export const ownConfig = (what) => `${PREFIX}zapis własnej konfiguracji: ${clip(what, 120)}`

/** `zmiana systemu lub innej maszyny: {tool}` */
export const systemChange = (tool) => `${PREFIX}zmiana systemu lub innej maszyny: ${tool}`

/** `brak danych o komendzie — pytam dla bezpieczeństwa` */
export const noCommandData = () => `${PREFIX}brak danych o komendzie — pytam dla bezpieczeństwa`

/** `błąd konfiguracji ({err}) — pytam dla bezpieczeństwa` */
export const configError = (err) => `${PREFIX}błąd konfiguracji (${clip(err, 200)}) — pytam dla bezpieczeństwa`

/** `{agent} ma powłokę tylko do odczytu — {co} poza profilem; użyj narzędzi read/grep/glob albo deleguj` (spec §4.7a) */
export const restrictedShell = (agent, what) =>
  `${PREFIX}${agent} ma powłokę tylko do odczytu — ${clip(what, 80)} poza profilem; użyj narzędzi read/grep/glob albo deleguj`

/** `błąd pluginu ({err}) — pytam dla bezpieczeństwa` */
export const pluginError = (err) => `${PREFIX}błąd pluginu (${err}) — pytam dla bezpieczeństwa`
