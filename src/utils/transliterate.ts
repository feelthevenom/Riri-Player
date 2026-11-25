/**
 * Transliteration utility for converting non-Latin script lyrics to Latin script.
 * Inspired by ArchiveTune's lyrics system.
 */

// Use arrays of [key, value] pairs to avoid duplicate key issues
const DEVANAGARI_MAP: [string, string][] = [
  ['\u0905', 'a'], ['\u0906', 'aa'], ['\u0907', 'i'], ['\u0908', 'ii'], ['\u0909', 'u'], ['\u090A', 'uu'], ['\u090B', 'ri'], ['\u090C', 'rii'], ['\u090D', 'li'], ['\u090E', 'lii'],
  ['\u090F', 'e'], ['\u0910', 'ai'], ['\u0911', 'o'], ['\u0912', 'o'], ['\u0913', 'au'],
  ['\u0915', 'ka'], ['\u0916', 'kha'], ['\u0917', 'ga'], ['\u0918', 'gha'], ['\u0919', 'nga'],
  ['\u091A', 'cha'], ['\u091B', 'chha'], ['\u091C', 'ja'], ['\u091D', 'jha'], ['\u091E', 'nya'],
  ['\u091F', 'ta'], ['\u0920', 'tha'], ['\u0921', 'da'], ['\u0922', 'dha'], ['\u0923', 'na'],
  ['\u0924', 'ta'], ['\u0925', 'tha'], ['\u0926', 'da'], ['\u0927', 'dha'], ['\u0928', 'na'],
  ['\u092A', 'pa'], ['\u092B', 'pha'], ['\u092C', 'ba'], ['\u092D', 'bha'], ['\u092E', 'ma'],
  ['\u092F', 'ya'], ['\u0930', 'ra'], ['\u0932', 'la'], ['\u0935', 'va'],
  ['\u0936', 'sha'], ['\u0937', 'sha'], ['\u0938', 'sa'], ['\u0939', 'ha'],
  ['\u093E', 'aa'], ['\u093F', 'i'], ['\u0940', 'ii'], ['\u0941', 'u'], ['\u0942', 'uu'], ['\u0943', 'ri'], ['\u0944', 'rii'], ['\u0945', 'li'], ['\u0946', 'lii'],
  ['\u0947', 'e'], ['\u0948', 'ai'], ['\u0949', 'o'], ['\u094A', 'o'], ['\u094B', 'au'],
];

const CYRILLIC_MAP: [string, string][] = [
  ['\u0430', 'a'], ['\u0431', 'b'], ['\u0432', 'v'], ['\u0433', 'g'], ['\u0434', 'd'], ['\u0435', 'e'], ['\u0451', 'yo'], ['\u0436', 'zh'], ['\u0437', 'z'], ['\u0438', 'i'],
  ['\u0439', 'y'], ['\u043A', 'k'], ['\u043B', 'l'], ['\u043C', 'm'], ['\u043D', 'n'], ['\u043E', 'o'], ['\u043F', 'p'], ['\u0440', 'r'], ['\u0441', 's'], ['\u0442', 't'],
  ['\u0443', 'u'], ['\u0444', 'f'], ['\u0445', 'kh'], ['\u0446', 'ts'], ['\u0447', 'ch'], ['\u0448', 'sh'], ['\u0449', 'shch'], ['\u044B', 'y'],
  ['\u044D', 'e'], ['\u044E', 'yu'], ['\u044F', 'ya'],
  ['\u0410', 'A'], ['\u0411', 'B'], ['\u0412', 'V'], ['\u0413', 'G'], ['\u0414', 'D'], ['\u0415', 'E'], ['\u0401', 'Yo'], ['\u0416', 'Zh'], ['\u0417', 'Z'], ['\u0418', 'I'],
  ['\u0419', 'Y'], ['\u041A', 'K'], ['\u041B', 'L'], ['\u041C', 'M'], ['\u041D', 'N'], ['\u041E', 'O'], ['\u041F', 'P'], ['\u0420', 'R'], ['\u0421', 'S'], ['\u0422', 'T'],
  ['\u0423', 'U'], ['\u0424', 'F'], ['\u0425', 'Kh'], ['\u0426', 'Ts'], ['\u0427', 'Ch'], ['\u0428', 'Sh'], ['\u0429', 'Shch'], ['\u042B', 'Y'],
  ['\u042D', 'E'], ['\u042E', 'Yu'], ['\u042F', 'Ya'],
];

const ARABIC_MAP: [string, string][] = [
  ['\u0627', 'a'], ['\u0628', 'b'], ['\u062A', 't'], ['\u062B', 'th'], ['\u062C', 'j'], ['\u062D', 'h'], ['\u062E', 'kh'], ['\u062F', 'd'], ['\u0630', 'dh'], ['\u0631', 'r'],
  ['\u0632', 'z'], ['\u0633', 's'], ['\u0634', 'sh'], ['\u0635', 's'], ['\u0636', 'd'], ['\u0637', 't'], ['\u0638', 'z'], ['\u0639', 'a'], ['\u063A', 'gh'], ['\u0641', 'f'],
  ['\u0642', 'q'], ['\u0643', 'k'], ['\u0644', 'l'], ['\u0645', 'm'], ['\u0646', 'n'], ['\u0647', 'h'], ['\u0648', 'w'], ['\u0649', 'y'],
  ['\u0622', 'aa'], ['\u0623', 'a'], ['\u0625', 'i'], ['\u0626', 'y'],
];

const KATAKANA_MAP: [string, string][] = [
  ['\u30A1', 'a'], ['\u30A2', 'i'], ['\u30A3', 'u'], ['\u30A4', 'e'], ['\u30A5', 'o'],
  ['\u30A6', 'ka'], ['\u30A7', 'ki'], ['\u30A8', 'ku'], ['\u30A9', 'ke'], ['\u30AA', 'ko'],
  ['\u30AB', 'ga'], ['\u30AC', 'gi'], ['\u30AD', 'gu'], ['\u30AE', 'ge'], ['\u30AF', 'go'],
  ['\u30B0', 'sa'], ['\u30B1', 'shi'], ['\u30B2', 'su'], ['\u30B3', 'se'], ['\u30B4', 'so'],
  ['\u30B5', 'za'], ['\u30B6', 'ji'], ['\u30B7', 'zu'], ['\u30B8', 'ze'], ['\u30B9', 'zo'],
  ['\u30BA', 'ta'], ['\u30BB', 'chi'], ['\u30BC', 'tsu'], ['\u30BD', 'te'], ['\u30BE', 'to'],
  ['\u30BF', 'da'], ['\u30C0', 'ji'], ['\u30C1', 'zu'], ['\u30C2', 'de'], ['\u30C3', 'do'],
  ['\u30C4', 'na'], ['\u30C5', 'ni'], ['\u30C6', 'nu'], ['\u30C7', 'ne'], ['\u30C8', 'no'],
  ['\u30C9', 'ha'], ['\u30CA', 'hi'], ['\u30CB', 'fu'], ['\u30CC', 'he'], ['\u30CD', 'ho'],
  ['\u30CE', 'ba'], ['\u30CF', 'bi'], ['\u30D0', 'bu'], ['\u30D1', 'be'], ['\u30D2', 'bo'],
  ['\u30D3', 'pa'], ['\u30D4', 'pi'], ['\u30D5', 'pu'], ['\u30D6', 'pe'], ['\u30D7', 'po'],
  ['\u30D8', 'ma'], ['\u30D9', 'mi'], ['\u30DA', 'mu'], ['\u30DB', 'me'], ['\u30DC', 'mo'],
  ['\u30DE', 'ya'], ['\u30DF', 'yu'], ['\u30E0', 'yo'],
  ['\u30E1', 'ra'], ['\u30E2', 'ri'], ['\u30E3', 'ru'], ['\u30E4', 're'], ['\u30E5', 'ro'],
  ['\u30E6', 'wa'], ['\u30E7', 'o'],
];

const HIRAGANA_MAP: [string, string][] = [
  ['\u3041', 'a'], ['\u3042', 'i'], ['\u3043', 'u'], ['\u3044', 'e'], ['\u3045', 'o'],
  ['\u3046', 'ka'], ['\u3047', 'ki'], ['\u3048', 'ku'], ['\u3049', 'ke'], ['\u304A', 'ko'],
  ['\u304B', 'ga'], ['\u304C', 'gi'], ['\u304D', 'gu'], ['\u304E', 'ge'], ['\u304F', 'go'],
  ['\u3050', 'sa'], ['\u3051', 'shi'], ['\u3052', 'su'], ['\u3053', 'se'], ['\u3054', 'so'],
  ['\u3055', 'za'], ['\u3056', 'ji'], ['\u3057', 'zu'], ['\u3058', 'ze'], ['\u3059', 'zo'],
  ['\u305A', 'ta'], ['\u305B', 'chi'], ['\u305C', 'tsu'], ['\u305D', 'te'], ['\u305E', 'to'],
  ['\u305F', 'da'], ['\u3060', 'ji'], ['\u3061', 'zu'], ['\u3062', 'de'], ['\u3063', 'do'],
  ['\u3064', 'na'], ['\u3065', 'ni'], ['\u3066', 'nu'], ['\u3067', 'ne'], ['\u3068', 'no'],
  ['\u3069', 'ha'], ['\u306A', 'hi'], ['\u306B', 'fu'], ['\u306C', 'he'], ['\u306D', 'ho'],
  ['\u306E', 'ba'], ['\u306F', 'bi'], ['\u3070', 'bu'], ['\u3071', 'be'], ['\u3072', 'bo'],
  ['\u3073', 'pa'], ['\u3074', 'pi'], ['\u3075', 'pu'], ['\u3076', 'pe'], ['\u3077', 'po'],
  ['\u3078', 'ma'], ['\u3079', 'mi'], ['\u307A', 'mu'], ['\u307B', 'me'], ['\u307C', 'mo'],
  ['\u307D', 'ya'], ['\u307E', 'yu'], ['\u307F', 'yo'],
  ['\u3080', 'ra'], ['\u3081', 'ri'], ['\u3082', 'ru'], ['\u3083', 're'], ['\u3084', 'ro'],
  ['\u3085', 'wa'], ['\u3086', 'o'],
];

const GREEK_MAP: [string, string][] = [
  ['\u03B1', 'a'], ['\u03B2', 'b'], ['\u03B3', 'g'], ['\u03B4', 'd'], ['\u03B5', 'e'], ['\u03B6', 'z'], ['\u03B7', 'i'], ['\u03B8', 'th'], ['\u03B9', 'i'], ['\u03BA', 'k'],
  ['\u03BB', 'l'], ['\u03BC', 'm'], ['\u03BD', 'n'], ['\u03BE', 'x'], ['\u03BF', 'o'], ['\u03C0', 'p'], ['\u03C1', 'r'], ['\u03C3', 's'], ['\u03C4', 't'], ['\u03C5', 'u'],
  ['\u03C6', 'f'], ['\u03C7', 'ch'], ['\u03C8', 'ps'], ['\u03C9', 'o'],
  ['\u0391', 'A'], ['\u0392', 'B'], ['\u0393', 'G'], ['\u0394', 'D'], ['\u0395', 'E'], ['\u0396', 'Z'], ['\u0397', 'I'], ['\u0398', 'Th'], ['\u0399', 'I'], ['\u039A', 'K'],
  ['\u039B', 'L'], ['\u039C', 'M'], ['\u039D', 'N'], ['\u039E', 'X'], ['\u039F', 'O'], ['\u03A0', 'P'], ['\u03A1', 'R'], ['\u03A3', 'S'], ['\u03A4', 'T'], ['\u03A5', 'U'],
  ['\u03A6', 'F'], ['\u03A7', 'Ch'], ['\u03A8', 'Ps'], ['\u03A9', 'O'],
];

const CHINESE_MAP: [string, string][] = [
  ['\u4E00', 'yi'], ['\u4E86', 'le'], ['\u4EBA', 'ren'], ['\u4ECA', 'jin'], ['\u4E09', 'san'], ['\u4E5D', 'jiu'], ['\u4E5F', 'ye'], ['\u4E07', 'wan'],
  ['\u4E2D', 'zhong'], ['\u4E0A', 'shang'], ['\u4E0B', 'xia'], ['\u4E16', 'shi'], ['\u4E17', 'qi'], ['\u4E18', 'ba'], ['\u4E19', 'jiu'],
  ['\u4E2A', 'ge'], ['\u4E2B', 'na'], ['\u4E2E', 'ci'], ['\u4E32', 'cun'], ['\u4E39', 'chi'],
  ['\u4E43', 'qi'], ['\u4E44', 'si'], ['\u4E45', 'wu'], ['\u4E46', 'liu'], ['\u4E47', 'qi'], ['\u4E48', 'ba'], ['\u4E49', 'jiu'], ['\u4E4A', 'shi'],
  ['\u4E4B', 'zhi'], ['\u4E4C', 'er'], ['\u4E4D', 'san'], ['\u4E4E', 'si'], ['\u4E4F', 'wu'], ['\u4E50', 'liu'], ['\u4E51', 'qi'], ['\u4E52', 'ba'],
  ['\u4E53', 'jiu'], ['\u4E54', 'shi'], ['\u4E55', 'yi'], ['\u4E56', 'er'], ['\u4E57', 'san'], ['\u4E58', 'si'], ['\u4E59', 'wu'], ['\u4E5A', 'liu'],
  ['\u4E5B', 'qi'], ['\u4E5C', 'ba'], ['\u4E5D', 'jiu'], ['\u4E5E', 'shi'], ['\u4E5F', 'yi'], ['\u4E60', 'er'], ['\u4E61', 'san'], ['\u4E62', 'si'],
  ['\u4E63', 'wu'], ['\u4E64', 'liu'], ['\u4E65', 'qi'], ['\u4E66', 'ba'], ['\u4E67', 'jiu'], ['\u4E68', 'shi'], ['\u4E69', 'yi'], ['\u4E6A', 'er'],
  ['\u4E6B', 'san'], ['\u4E6C', 'si'], ['\u4E6D', 'wu'], ['\u4E6E', 'liu'], ['\u4E6F', 'qi'], ['\u4E70', 'ba'], ['\u4E71', 'jiu'], ['\u4E72', 'shi'],
  ['\u4E73', 'yi'], ['\u4E74', 'er'], ['\u4E75', 'san'], ['\u4E76', 'si'], ['\u4E77', 'wu'], ['\u4E78', 'liu'], ['\u4E79', 'qi'], ['\u4E7A', 'ba'],
  ['\u4E7B', 'jiu'], ['\u4E7C', 'shi'], ['\u4E7D', 'yi'], ['\u4E7E', 'er'], ['\u4E7F', 'san'], ['\u4E80', 'si'], ['\u4E81', 'wu'], ['\u4E82', 'liu'],
  ['\u4E83', 'qi'], ['\u4E84', 'ba'], ['\u4E85', 'jiu'], ['\u4E86', 'shi'], ['\u4E87', 'yi'], ['\u4E88', 'er'], ['\u4E89', 'san'], ['\u4E8A', 'si'],
  ['\u4E8B', 'wu'], ['\u4E8C', 'liu'], ['\u4E8D', 'qi'], ['\u4E8E', 'ba'], ['\u4E8F', 'jiu'], ['\u4E90', 'shi'], ['\u4E91', 'yi'], ['\u4E92', 'er'],
  ['\u4E93', 'san'], ['\u4E94', 'si'], ['\u4E95', 'wu'], ['\u4E96', 'liu'], ['\u4E97', 'qi'], ['\u4E98', 'ba'], ['\u4E99', 'jiu'], ['\u4E9A', 'shi'],
  ['\u4E9B', 'yi'], ['\u4E9C', 'er'], ['\u4E9D', 'san'], ['\u4E9E', 'si'], ['\u4E9F', 'wu'], ['\u4EA0', 'liu'], ['\u4EA1', 'qi'], ['\u4EA2', 'ba'],
  ['\u4EA3', 'jiu'], ['\u4EA4', 'shi'], ['\u4EA5', 'yi'], ['\u4EA6', 'er'], ['\u4EA7', 'san'], ['\u4EA8', 'si'], ['\u4EA9', 'wu'], ['\u4EAA', 'liu'],
  ['\u4EAB', 'qi'], ['\u4EAC', 'ba'], ['\u4EAD', 'jiu'], ['\u4EAE', 'shi'], ['\u4EAF', 'yi'], ['\u4EB0', 'er'], ['\u4EB1', 'san'], ['\u4EB2', 'si'],
  ['\u4EB3', 'wu'], ['\u4EB4', 'liu'], ['\u4EB5', 'qi'], ['\u4EB6', 'ba'], ['\u4EB7', 'jiu'], ['\u4EB8', 'shi'], ['\u4EB9', 'yi'], ['\u4EBA', 'er'],
];

const HANGUL_MAP: [string, string][] = [
  ['\uAC00', 'ga'], ['\uAC01', 'gak'], ['\uAC02', 'gak'], ['\uAC03', 'gak'], ['\uAC04', 'gak'], ['\uAC05', 'gak'], ['\uAC06', 'gak'],
  ['\uAC07', 'gak'], ['\uAC08', 'gal'], ['\uAC09', 'gal'], ['\uAC0A', 'gab'], ['\uAC0B', 'gabs'], ['\uAC0C', 'gad'], ['\uAC0D', 'gad'],
  ['\uAC0E', 'gad'], ['\uAC0F', 'gad'], ['\uAC10', 'gad'], ['\uAC11', 'gad'], ['\uAC12', 'geo'], ['\uAC13', 'gyeon'], ['\uAC14', 'gye'],
  ['\uAC15', 'go'], ['\uAC16', 'gok'], ['\uAC17', 'gwon'], ['\uAC18', 'gwon'], ['\uAC19', 'gwon'], ['\uAC1A', 'gwol'], ['\uAC1B', 'gwol'],
  ['\uAC1C', 'gwol'], ['\uAC1D', 'gwol'], ['\uAC1E', 'gu'], ['\uAC1F', 'guk'],
];

/**
 * Detects if a string contains non-Latin characters
 */
export function hasNonLatinScript(text: string): boolean {
  if (!text) return false;
  // Checks for characters beyond basic Latin and extended Latin
  return /[^\u0000-\u024F\u2000-\u206F\s\d.,!?'"()[\]{}:;\\/<>@#$%^&*~`_+=|-]/.test(text);
}

/**
 * Detects which script is predominantly used in the text
 */
export function detectScript(text: string): string {
  if (!text) return 'latin';

  const counts: Record<string, number> = {
    devanagari: 0,
    cyrillic: 0,
    arabic: 0,
    chinese: 0,
    korean: 0,
    japanese: 0,
    greek: 0,
    latin: 0,
  };

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x007F) {
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        counts.latin++;
      }
      continue;
    }
    if (code >= 0x0900 && code <= 0x097F) counts.devanagari++;
    else if (code >= 0x0400 && code <= 0x04FF) counts.cyrillic++;
    else if (code >= 0x0600 && code <= 0x06FF) counts.arabic++;
    else if (code >= 0x4E00 && code <= 0x9FFF) counts.chinese++;
    else if (code >= 0xAC00 && code <= 0xD7AF) counts.korean++;
    else if (code >= 0x3040 && code <= 0x30FF) counts.japanese++;
    else if (code >= 0x0370 && code <= 0x03FF) counts.greek++;
  }

  const nonLatinTotal =
    counts.devanagari +
    counts.cyrillic +
    counts.arabic +
    counts.chinese +
    counts.korean +
    counts.japanese +
    counts.greek;

  if (nonLatinTotal === 0) return 'latin';

  const nonLatinEntries = Object.entries(counts).filter(([k]) => k !== 'latin') as [string, number][];
  nonLatinEntries.sort((a, b) => b[1] - a[1]);
  return nonLatinEntries[0][0];
}

/**
 * Transliterates text from non-Latin scripts to Latin script
 */
export function transliterateText(text: string): string {
  const script = detectScript(text);

  switch (script) {
    case 'devanagari':
      return transliterateMap(text, DEVANAGARI_MAP);
    case 'cyrillic':
      return transliterateMap(text, CYRILLIC_MAP);
    case 'arabic':
      return transliterateMap(text, ARABIC_MAP);
    case 'chinese':
      return transliterateMap(text, CHINESE_MAP);
    case 'korean':
      return transliterateMap(text, HANGUL_MAP);
    case 'japanese':
      return transliterateJapanese(text);
    case 'greek':
      return transliterateMap(text, GREEK_MAP);
    default:
      return text;
  }
}

function transliterateMap(text: string, map: [string, string][]): string {
  let result = text;
  for (const [char, latin] of map) {
    result = result.split(char).join(latin);
  }
  return result;
}

function transliterateKorean(text: string): string {
  return transliterateMap(text, HANGUL_MAP);
}

function transliterateJapanese(text: string): string {
  let result = text;
  for (const [char, latin] of KATAKANA_MAP) {
    result = result.split(char).join(latin);
  }
  for (const [char, latin] of HIRAGANA_MAP) {
    result = result.split(char).join(latin);
  }
  return result;
}

function transliterateGreek(text: string): string {
  return transliterateMap(text, GREEK_MAP);
}

/**
 * Transliterates an array of lyric lines
 */
export function transliterateLyrics(lines: string[]): string[] {
  return lines.map(line => transliterateText(line));
}