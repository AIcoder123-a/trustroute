/**
 * MOCK ADAPTER — NOT CLOCKED OUTPUT.
 *
 * There is no API key configured, so this module produces *synthetic*
 * detection results from local pattern matching so the product can be
 * demonstrated end to end. Everything it emits is marked `mode: 'mock'` and the
 * UI shows a permanent banner. It must never be presented as a Clocked verdict,
 * and `CLOCKED_MODE=live` refuses to start without a key rather than falling
 * back here.
 *
 * The patterns below are deliberately simple. They exist to make the demo cases
 * behave consistently, not to detect prompt injection.
 */

import type { ContentType, GuardData, InspectData, PiiEntity, ProtectData } from '../types';

interface Rule {
  pattern: RegExp;
  weight: number;
  category: string;
}

const INJECTION_RULES: Rule[] = [
  { pattern: /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|prompts?)/gi, weight: 0.72, category: 'instruction override' },
  { pattern: /disregard (all |any )?(the )?(previous|prior|your) (instructions|rules)/gi, weight: 0.7, category: 'instruction override' },
  { pattern: /\[system (notification|message|override|notice)/gi, weight: 0.38, category: 'instruction override' },
  { pattern: /directive (update|override)/gi, weight: 0.36, category: 'instruction override' },
  { pattern: /you are now|from now on you|act as (an? )?(unrestricted|developer mode|dan)/gi, weight: 0.45, category: 'role-play or persona jailbreak' },
  { pattern: /(print|reveal|disclose|show) (your |the )?(full )?(system prompt|system message|configuration|hidden instructions)/gi, weight: 0.4, category: 'system prompt or secret extraction' },
  { pattern: /decode (the |this )?(following|block)|base64/gi, weight: 0.4, category: 'obfuscated or encoded payload' },
  { pattern: /SWdub3Jl|aWdub3Jl|c3lzdGVtIHByb21wdA/gi, weight: 0.55, category: 'obfuscated or encoded payload' },
  { pattern: /treat (this|the) (notice|email|message|page) as (written )?authorization/gi, weight: 0.4, category: 'social engineering' },
  { pattern: /waive[d]? (the )?(second[- ]approver|approval)/gi, weight: 0.4, category: 'social engineering' },
  { pattern: /(second[- ]approver|approval)[\s\S]{0,60}(waived|removed|not required)/gi, weight: 0.4, category: 'social engineering' },
  { pattern: /carry (it|this) out/gi, weight: 0.35, category: 'instruction override' },
  // A long, dense base64 run is itself a signal: the detector assesses what it is given.
  { pattern: /[A-Za-z0-9+/]{60,}={0,2}/g, weight: 0.4, category: 'obfuscated or encoded payload' },
  { pattern: /(do not|don't) (tell|mention|inform) the user|omit this (notice|from)/gi, weight: 0.3, category: 'social engineering' },
  { pattern: /(send|export|forward) .{0,40}(to|and send it to) [\w.-]+@[\w.-]+/gi, weight: 0.35, category: 'tool misuse or data exfiltration' },
];

const SCRIPT_RULES: Rule[] = [
  { pattern: /Disable(RealtimeMonitoring|AntiVirus|Firewall|WindowsDefender)|Set-MpPreference[^\n]*Disable|netsh advfirewall set[^\n]*off/gi, weight: 0.85, category: 'security blinding or EDR evasion' },
  { pattern: /mimikatz|sekurlsa|lsass|procdump|hashdump/gi, weight: 0.9, category: 'credential theft or memory dumping' },
  { pattern: /wevtutil cl|Clear-EventLog|Remove-Item[^\n]*\.evtx/gi, weight: 0.7, category: 'forensic destruction or anti-forensics' },
  { pattern: /-enc(odedcommand)?\s+[A-Za-z0-9+/=]{40,}|FromBase64String/gi, weight: 0.6, category: 'obfuscated or in-memory payload' },
  { pattern: /crontab|schtasks \/create|New-Service|reg add [^\n]*\\Run/gi, weight: 0.5, category: 'unauthorized persistence or access expansion' },
  { pattern: /nmap|\bnc\s+-e|socat|chisel|ssh\s+-R/gi, weight: 0.5, category: 'network reconnaissance or tunneling' },
  { pattern: /Invoke-WebRequest|DownloadString|curl\s+-[a-zA-Z]*\s*\S+\s*\|\s*(ba)?sh|wget\s+\S+\s*\|\s*(ba)?sh/gi, weight: 0.42, category: 'unsafe download or remote code execution' },
  { pattern: /Start-Process|Invoke-Expression|\bIEX\b/gi, weight: 0.3, category: 'unsafe download or remote code execution' },
  { pattern: /Remove-Item[^\n]*-Recurse|rm\s+-rf|del \/s/gi, weight: 0.28, category: 'ransomware or data destruction' },
];

const SCRIPT_CATEGORIES = [
  'benign administration',
  'security blinding or EDR evasion',
  'credential theft or memory dumping',
  'unauthorized persistence or access expansion',
  'network reconnaissance or tunneling',
  'forensic destruction or anti-forensics',
  'ransomware or data destruction',
  'obfuscated or in-memory payload',
  'unsafe download or remote code execution',
  'data exfiltration',
];

const INJECTION_CATEGORIES = [
  'benign',
  'instruction override',
  'role-play or persona jailbreak',
  'system prompt or secret extraction',
  'obfuscated or encoded payload',
  'tool misuse or data exfiltration',
  'social engineering',
];

interface Hit {
  weight: number;
  category: string;
  start: number;
  end: number;
  quote: string;
}

function collect(text: string, rules: Rule[]): Hit[] {
  const hits: Hit[] = [];
  for (const rule of rules) {
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      hits.push({
        weight: rule.weight,
        category: rule.category,
        start: match.index,
        end: match.index + match[0].length,
        quote: match[0],
      });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

function combine(hits: Hit[]): number {
  if (hits.length === 0) return 0;
  const surviving = hits.reduce((acc, hit) => acc * (1 - hit.weight), 1);
  return Math.min(0.995, Number((1 - surviving).toFixed(4)));
}

function distribution(categories: string[], winner: string | null, confidence: number): Record<string, number> {
  const out: Record<string, number> = {};
  const rest = (1 - confidence) / Math.max(1, categories.length - (winner ? 1 : 0));
  for (const category of categories) {
    out[category] = Number((category === winner ? confidence : rest).toFixed(4));
  }
  return out;
}

function severityFor(score: number): { severity: string; expected: number; severities: Record<string, number> } {
  if (score >= 0.85) return { severity: 'critical', expected: 4.6, severities: { none: 0.01, low: 0.01, medium: 0.03, high: 0.19, critical: 0.76 } };
  if (score >= 0.65) return { severity: 'high', expected: 3.7, severities: { none: 0.02, low: 0.03, medium: 0.12, high: 0.6, critical: 0.23 } };
  if (score >= 0.5) return { severity: 'medium', expected: 2.9, severities: { none: 0.05, low: 0.08, medium: 0.55, high: 0.26, critical: 0.06 } };
  return { severity: 'none', expected: 0.4, severities: { none: 0.78, low: 0.16, medium: 0.04, high: 0.015, critical: 0.005 } };
}

export function mockGuard(text: string, contentType: ContentType): GuardData {
  const hits = collect(text, INJECTION_RULES);
  const probability = combine(hits);
  const top = hits.length > 0 ? hits.reduce((a, b) => (b.weight > a.weight ? b : a)) : null;
  const { severity, expected, severities } = severityFor(probability);
  const verdict = probability >= 0.5 ? 'injection' : 'benign';
  const winner = top?.category ?? 'benign';

  return {
    model: 'mock-heuristic (not Clocked)',
    injection: probability,
    verdict,
    threshold: 0.5,
    category: winner,
    categories: distribution(INJECTION_CATEGORIES, winner, probability > 0.5 ? Math.min(0.95, Math.max(0.5, probability)) : 0.93),
    severity,
    severities,
    severityExpected: expected,
    evidence: hits.map((hit) => ({
      quote: hit.quote,
      start: hit.start,
      end: hit.end,
      confidence: Number(Math.min(1, 0.6 + hit.weight).toFixed(2)),
    })),
    source: contentType === 'web_content' || contentType === 'tool_output' ? 'content' : 'user',
    instructionsUsed: 'mock',
  };
}

const PERSON_NAME = /\b(?:Customer|Name|Contact|Employee|Requester|full_name)\s*[:"]\s*"?([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})/g;
const ADDRESS = /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?\s(?:Way|Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct)\b[^\n]*/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{3}\)[\s-]?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD = /\b(?:\d{4}[ -]){3}\d{4}\b|\b(?:\d{4}[ -]){2}\d{4}[ -]\d{1,4}\b/g;
const DOB = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\s(?:January|February|March|April|May|June|July|August|September|October|November|December)\s(?:19|20)\d{2}\b/g;
const IP = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

type FoundEntity = PiiEntity;

function scan(text: string, regex: RegExp, type: string): FoundEntity[] {
  const out: FoundEntity[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1] ?? match[0];
    const offset = match.index + match[0].indexOf(value);
    if (value.length === 0) continue;
    out.push({ type, value, start: offset, end: offset + value.length, confidence: 0.9, source: 'mock' });
  }
  return out;
}

export function mockProtect(text: string): ProtectData {
  const entities = [
    ...scan(text, PERSON_NAME, 'person'),
    ...scan(text, EMAIL, 'email'),
    ...scan(text, PHONE, 'phone'),
    ...scan(text, SSN, 'ssn'),
    ...scan(text, CARD, 'credit_card'),
    ...scan(text, DOB, 'date_of_birth'),
    ...scan(text, ADDRESS, 'address'),
    ...scan(text, IP, 'ip_address'),
  ]
    .filter((entity, index, all) => all.findIndex((other) => other.start === entity.start && other.end === entity.end) === index)
    .sort((a, b) => a.start - b.start);

  const counts: Record<string, number> = {};
  for (const entity of entities) counts[entity.type] = (counts[entity.type] ?? 0) + 1;

  // Mirror `anonymize: "replace"` so the UI's comparison view has something to
  // compare against. The real comparison is built independently in lib/redact.
  let anonymized = '';
  let cursor = 0;
  for (const entity of entities) {
    anonymized += text.slice(cursor, entity.start);
    anonymized += `<${entity.type.toUpperCase()}>`;
    cursor = entity.end;
  }
  anonymized += text.slice(cursor);

  return {
    model: 'mock-heuristic (not Clocked)',
    entities,
    counts,
    anonymizedText: anonymized,
    threshold: 0.5,
    instructionsUsed: 'mock',
  };
}

export function mockInspect(script: string): InspectData {
  const hits = collect(script, SCRIPT_RULES);
  const malicious = combine(hits);
  const suspicious = Math.min(0.99, Number((malicious + (hits.length > 0 ? 0.12 : 0)).toFixed(4)));
  const top = hits.length > 0 ? hits.reduce((a, b) => (b.weight > a.weight ? b : a)) : null;
  const verdict = malicious >= 0.8 ? 'malicious' : suspicious >= 0.5 ? 'suspicious' : 'benign';
  const winner = top?.category ?? 'benign administration';
  const { severity, expected, severities } = severityFor(Math.max(malicious, suspicious));

  return {
    model: 'mock-heuristic (not Clocked)',
    malicious,
    suspicious,
    verdict,
    threshold: 0.5,
    category: winner,
    categories: distribution(SCRIPT_CATEGORIES, winner, Math.min(0.95, Math.max(0.5, Math.max(malicious, suspicious)))),
    severity,
    severities,
    severityExpected: expected,
    evidence: hits.map((hit) => ({
      line: hit.quote,
      start: hit.start,
      end: hit.end,
      confidence: Number(Math.min(1, 0.6 + hit.weight).toFixed(2)),
    })),
    instructionsUsed: 'mock',
  };
}
