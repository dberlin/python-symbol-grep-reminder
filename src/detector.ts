export interface ToolCallLike {
  toolName: string;
  input: unknown;
}

type Candidate = {
  pattern: string;
  scope: string;
};

type VisitBudget = {
  count: number;
};

const MAX_NESTING_DEPTH = 5;
const MAX_VISITED_VALUES = 100;
const CONTEXT_EXECUTE_NAME =
  /^(?:(?:mcp__)?context[_-]?mode(?:__|_)?)?ctx_(?:batch_execute|execute(?:_file)?)$/iu;
const CONTEXT_WRITE_PATH = /^xd:\/\/mcp__context_mode_ctx_(?:batch_execute|execute(?:_file)?)$/iu;
const SEARCH_INVOCATION =
  /^\s*(?:command\s+)?(?:[\w.-]+\/)?(?<executable>rg|grep)\b(?<arguments>[\s\S]*)$/iu;
const EMBEDDED_SEARCH_INVOCATION =
  /(?:execSync|spawnSync)\s*\(\s*(?<quote>["'`])(?:command\s+)?(?:[\w.-]+\/)?(?<executable>rg|grep)\b(?<arguments>[\s\S]*?)\k<quote>/giu;
const SHELL_LANGUAGE = /^(?:bash|sh|shell|zsh)$/iu;
const PYTHON_SCOPE =
  /(?:\.py(?:\b|["'`*?])|--type(?:=|\s+)py\b|-tpy\b|--include(?:=|\s+)["'`]?[^\s]*\.py\b|-g(?:lob)?(?:=|\s+)["'`]?[^\s]*\.py\b)/iu;
const PYTHON_DECLARATION =
  /\b(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(|\bclass\s+[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*:/u;
const PYTHON_DEF_SEARCH = /^\^?\s*(?:async\s+)?def\s/u;
const PYTHON_FUNCTION_SEARCH =
  /^\^?\s*(?:async\s+)?def\s+(?:[A-Za-z_]\w*|\[[^\]]+\]\\w\*)\s*\(/u;
const CALL_OR_DECORATOR = /(?:\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(|@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/u;
const STRUCTURAL_DECLARATION_ALTERNATIVE =
  /^\s*\^?\s*(?:(?:\(\?:|\()\s*)*(?:(?:async\s+)?def\s+[A-Za-z_]\w*|class\s+[A-Za-z_]\w*)/u;
const STRUCTURAL_RETURN_OR_CALL_ALTERNATIVE =
  /^\s*\^?\s*(?:(?:\(\?:|\()\s*)*(?:return(?:\s+|$)|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\()/u;
const VALUE_OPTIONS: Record<string, true> = {
  "-A": true,
  "-B": true,
  "-C": true,
  "-f": true,
  "-g": true,
  "-m": true,
  "--after-context": true,
  "--before-context": true,
  "--binary-files": true,
  "--context": true,
  "--directories": true,
  "--encoding": true,
  "--engine": true,
  "--exclude": true,
  "--exclude-dir": true,
  "--file": true,
  "--glob": true,
  "--iglob": true,
  "--include": true,
  "--label": true,
  "--max-columns": true,
  "--max-count": true,
  "--max-depth": true,
  "--path-separator": true,
  "--pre": true,
  "--pre-glob": true,
  "--replace": true,
  "--sort": true,
  "--sortr": true,
  "--type": true,
  "--type-add": true,
  "--type-not": true,
};
const BOOLEAN_LONG_OPTIONS: Record<string, true> = {
  "--binary": true,
  "--case-sensitive": true,
  "--column": true,
  "--count": true,
  "--count-matches": true,
  "--files-with-matches": true,
  "--files-without-match": true,
  "--fixed-strings": true,
  "--follow": true,
  "--heading": true,
  "--hidden": true,
  "--ignore-case": true,
  "--invert-match": true,
  "--json": true,
  "--line-number": true,
  "--line-regexp": true,
  "--multiline": true,
  "--multiline-dotall": true,
  "--no-heading": true,
  "--no-ignore": true,
  "--no-line-number": true,
  "--one-file-system": true,
  "--pcre2": true,
  "--pretty": true,
  "--quiet": true,
  "--smart-case": true,
  "--text": true,
  "--word-regexp": true,
};

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeRegexSyntax(value: string): string {
  return value
    .replace(/\\\\/gu, "\\")
    .replace(/\\s[+*?]?/gu, " ")
    .replace(/\(\?:async\s+\)\?/gu, "async ")
    .replace(/\(async\s+\)\?/gu, "async ")
    .replace(/\\b/gu, "")
    .replace(/\\([()[\]{}.^$+*?|@])/gu, "$1");
}

type StructuralBranch = "declaration" | "other";

function structuralBranchKind(pattern: string): StructuralBranch | undefined {
  const normalized = normalizeRegexSyntax(pattern);
  if (STRUCTURAL_DECLARATION_ALTERNATIVE.test(normalized)) {
    return "declaration";
  }
  return STRUCTURAL_RETURN_OR_CALL_ALTERNATIVE.test(normalized) ? "other" : undefined;
}

function classifiesStructuralAlternation(pattern: string, hasPythonScope: boolean): boolean {
  let branchStart = 0;
  let precedingBackslashes = 0;
  let structuralBranches = 0;
  let hasDeclaration = false;
  let hasAlternation = false;

  const classifyBranch = (branchEnd: number): void => {
    const kind = structuralBranchKind(pattern.slice(branchStart, branchEnd));
    if (kind !== undefined) {
      structuralBranches += 1;
      hasDeclaration ||= kind === "declaration";
    }
  };

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      precedingBackslashes += 1;
      continue;
    }
    if (character === "|" && precedingBackslashes % 2 === 0) {
      hasAlternation = true;
      classifyBranch(index);
      branchStart = index + 1;
    }
    precedingBackslashes = 0;
  }

  if (!hasAlternation) {
    return false;
  }
  classifyBranch(pattern.length);
  return structuralBranches >= 2 && (hasDeclaration || hasPythonScope);
}


function classifies(candidate: Candidate): boolean {
  const normalized = normalizeRegexSyntax(candidate.pattern);
  const hasPythonScope = PYTHON_SCOPE.test(`${candidate.scope} ${candidate.pattern}`);
  const hasNamedDeclaration = PYTHON_DECLARATION.test(normalized);
  const hasDefinitionSearch = PYTHON_DEF_SEARCH.test(normalized);
  const hasStrongDefinitionSearch = PYTHON_FUNCTION_SEARCH.test(normalized);
  const hasDeclaration = hasNamedDeclaration || hasStrongDefinitionSearch || (hasPythonScope && hasDefinitionSearch);
  const hasStructuralAlternation = classifiesStructuralAlternation(candidate.pattern, hasPythonScope);
  const hasPython = hasDeclaration || hasStructuralAlternation || hasPythonScope;
  const hasSymbol = hasDeclaration || hasStructuralAlternation || CALL_OR_DECORATOR.test(normalized);
  return hasPython && hasSymbol;
}

function tokenizeShellArguments(argumentsText: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: "'" | "\"" | "`" | undefined;

  for (let index = 0; index < argumentsText.length; index += 1) {
    const char = argumentsText[index]!;
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
        tokenStarted = true;
        continue;
      }
      if (char === "\\" && quote !== "'" && index + 1 < argumentsText.length) {
        token += char + argumentsText[index + 1]!;
        tokenStarted = true;
        index += 1;
        continue;
      }
      token += char;
      tokenStarted = true;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/u.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    if (char === "\\" && index + 1 < argumentsText.length) {
      token += char + argumentsText[index + 1]!;
      tokenStarted = true;
      index += 1;
      continue;
    }
    token += char;
    tokenStarted = true;
  }

  if (quote !== undefined) return [];
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function splitShellCommands(command: string): string[] {
  const commands: string[] = [];
  let commandStart = 0;
  let quote: "'" | "\"" | "`" | undefined;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else if (character === "\\" && quote !== "'" && index + 1 < command.length) {
        index += 1;
      }
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "\\" && index + 1 < command.length) {
      index += 1;
      continue;
    }
    if (character === "\n" || character === ";" || character === "&" || character === "|") {
      commands.push(command.slice(commandStart, index));
      commandStart = index + 1;
    }
  }

  commands.push(command.slice(commandStart));
  return commands;
}

function extractSearchPatterns(executable: "grep" | "rg", argumentsText: string): string[] {
  const patterns: string[] = [];
  const tokens = tokenizeShellArguments(argumentsText);
  let optionsEnabled = true;
  let usesPatternFile = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (optionsEnabled && token === "--") {
      optionsEnabled = false;
      continue;
    }
    if (optionsEnabled && token.startsWith("--regexp=")) {
      patterns.push(token.slice("--regexp=".length));
      continue;
    }
    if (optionsEnabled && (token === "-e" || token === "--regexp")) {
      const pattern = tokens[index + 1];
      if (pattern !== undefined) {
        patterns.push(pattern);
        index += 1;
      }
      continue;
    }
    if (optionsEnabled && token.startsWith("-e") && !token.startsWith("--") && token.length > 2) {
      patterns.push(token.slice(2));
      continue;
    }
    if (
      optionsEnabled &&
      (token === "-f" || token === "--file" || token.startsWith("-f") || token.startsWith("--file="))
    ) {
      usesPatternFile = true;
      if ((token === "-f" || token === "--file") && tokens[index + 1] !== undefined) index += 1;
      continue;
    }
    if (optionsEnabled && token.startsWith("-")) {
      if (token.includes("=")) continue;
      if ((token === "-r" && executable === "rg") || VALUE_OPTIONS[token]) {
        if (tokens[index + 1] !== undefined) index += 1;
        continue;
      }
      if (token.startsWith("--") && !BOOLEAN_LONG_OPTIONS[token]) return patterns;
      continue;
    }
    if (patterns.length > 0) continue;
    if (usesPatternFile) return [];
    return [token];
  }

  return patterns;
}

function extractCommandCandidates(command: string, embeddedOnly = false): Candidate[] {
  const candidates: Candidate[] = [];
  if (embeddedOnly) {
    for (const match of command.matchAll(EMBEDDED_SEARCH_INVOCATION)) {
      const executable = match.groups?.executable;
      const argumentsText = match.groups?.arguments ?? "";
      if (executable !== "grep" && executable !== "rg") continue;
      for (const pattern of extractSearchPatterns(executable, argumentsText)) {
        candidates.push({ pattern, scope: argumentsText });
      }
    }
    return candidates;
  }

  for (const shellCommand of splitShellCommands(command)) {
    const match = SEARCH_INVOCATION.exec(shellCommand);
    const executable = match?.groups?.executable;
    const argumentsText = match?.groups?.arguments ?? "";
    if (executable !== "grep" && executable !== "rg") continue;
    for (const pattern of extractSearchPatterns(executable, argumentsText)) {
      candidates.push({ pattern, scope: argumentsText });
    }
  }
  return candidates;
}

function collectContextCandidates(
  input: Record<string, unknown>,
  depth: number,
  budget: VisitBudget,
): Candidate[] {
  if (depth > MAX_NESTING_DEPTH || budget.count >= MAX_VISITED_VALUES) return [];
  budget.count += 1;

  const candidates: Candidate[] = [];
  const code = stringField(input, "code");
  const language = stringField(input, "language");
  const contextPath = stringField(input, "path") ?? "";
  if (code !== undefined) {
    const extracted = extractCommandCandidates(code, language === undefined || !SHELL_LANGUAGE.test(language));
    for (const candidate of extracted) {
      candidates.push({ ...candidate, scope: `${candidate.scope} ${contextPath}` });
    }
  }

  const commands = input.commands;
  if (!Array.isArray(commands)) return candidates;

  for (const commandEntry of commands) {
    if (budget.count >= MAX_VISITED_VALUES) break;
    budget.count += 1;
    if (typeof commandEntry !== "object" || commandEntry === null || Array.isArray(commandEntry)) continue;
    const entry = commandEntry as Record<string, unknown>;
    const command = stringField(entry, "command");
    if (command !== undefined) candidates.push(...extractCommandCandidates(command));

    const nested = entry.input;
    if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
      candidates.push(...collectContextCandidates(nested as Record<string, unknown>, depth + 1, budget));
    }
  }

  return candidates;
}

function extractMountedContextCandidates(input: Record<string, unknown>): Candidate[] {
  const path = stringField(input, "path");
  const content = stringField(input, "content");
  if (path === undefined || content === undefined || !CONTEXT_WRITE_PATH.test(path)) return [];

  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    return collectContextCandidates(parsed as Record<string, unknown>, 0, { count: 0 });
  } catch {
    return [];
  }
}

function extractCandidates(call: ToolCallLike): Candidate[] {
  if (typeof call.input !== "object" || call.input === null || Array.isArray(call.input)) return [];
  const input = call.input as Record<string, unknown>;
  if (call.toolName === "grep") {
    const pattern = stringField(input, "pattern");
    if (pattern === undefined) return [];
    return [{ pattern, scope: stringField(input, "path") ?? "" }];
  }

  if (call.toolName === "bash" || call.toolName === "shell" || call.toolName === "sh") {
    const command = stringField(input, "command");
    return command === undefined ? [] : extractCommandCandidates(command);
  }

  if (CONTEXT_EXECUTE_NAME.test(call.toolName)) {
    return collectContextCandidates(input, 0, { count: 0 });
  }

  if (call.toolName === "write") return extractMountedContextCandidates(input);
  return [];
}

export function isPythonSymbolGrepCall(call: ToolCallLike): boolean {
  try {
    return extractCandidates(call).some(classifies);
  } catch {
    return false;
  }
}
