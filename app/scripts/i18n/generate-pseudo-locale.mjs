import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPE, parse } from '@formatjs/icu-messageformat-parser';
import { printAST } from '@formatjs/icu-messageformat-parser/printer.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const sourcePath = path.join(reviewedDir, 'en.json');
const outputPath = path.join(reviewedDir, 'en-XA.json');
const brandTermsPath = path.join(appDir, 'src/i18n/glossary/brand-terms.json');
const COMPACT_ID_PATTERN = /^(nav|auth|checkout|common|status)\./;

const ACCENTS = {
    A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'Ë', F: 'Ƒ', G: 'Ĝ', H: 'Ħ', I: 'Ï',
    J: 'Ĵ', K: 'Ķ', L: 'Ŀ', M: 'M', N: 'Ñ', O: 'Ø', P: 'Þ', Q: 'Q', R: 'Ŕ',
    S: 'Š', T: 'Ŧ', U: 'Ü', V: 'V', W: 'Ŵ', X: 'X', Y: 'Ÿ', Z: 'Ž',
    a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'ë', f: 'ƒ', g: 'ĝ', h: 'ħ', i: 'ï',
    j: 'ĵ', k: 'ķ', l: 'ŀ', m: 'm', n: 'ñ', o: 'ø', p: 'þ', q: 'q', r: 'ŕ',
    s: 'š', t: 'ŧ', u: 'ü', v: 'v', w: 'ŵ', x: 'x', y: 'ÿ', z: 'ž',
};

const brandTerms = Object.entries(JSON.parse(fs.readFileSync(brandTermsPath, 'utf8')))
    .filter(([, rule]) => rule.doNotTranslate)
    .map(([term]) => term)
    .sort((left, right) => right.length - left.length);

const expandLiteral = (value = '') => {
    let protectedValue = String(value);
    const replacements = [];

    brandTerms.forEach((term) => {
        protectedValue = protectedValue.split(term).join(`§${replacements.push(term) - 1}§`);
    });

    const expandedValue = protectedValue.replace(/[A-Za-z]/g, (character, offset) => {
        const accented = ACCENTS[character] || character;
        return offset % 4 === 0 && /[aeiouAEIOU]/.test(character)
            ? `${accented}${accented.toLowerCase()}`
            : accented;
    });

    return replacements.reduce(
        (result, term, index) => result.split(`§${index}§`).join(term),
        expandedValue
    );
};

const transformAst = (ast = []) => ast.map((element) => {
    if (element.type === TYPE.literal) {
        return { ...element, value: expandLiteral(element.value) };
    }

    if (element.type === TYPE.plural || element.type === TYPE.select) {
        return {
            ...element,
            options: Object.fromEntries(Object.entries(element.options).map(([key, option]) => [
                key,
                { ...option, value: transformAst(option.value) },
            ])),
        };
    }

    if (element.type === TYPE.tag) {
        return { ...element, children: transformAst(element.children) };
    }

    return element;
});

export const pseudoLocalizeMessage = (message = '', { compact = false } = {}) => {
    const pseudoMessage = printAST(transformAst(parse(String(message || ''))));
    return compact ? `[${pseudoMessage}]` : `[${pseudoMessage} !!!]`;
};

const sourceMessages = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const pseudoMessages = Object.fromEntries(Object.entries(sourceMessages).map(([id, message]) => [
    id,
    pseudoLocalizeMessage(message, { compact: COMPACT_ID_PATTERN.test(id) }),
]));

fs.writeFileSync(outputPath, `${JSON.stringify(pseudoMessages, null, 2)}\n`, 'utf8');
console.log(`Generated pseudo locale: ${path.relative(appDir, outputPath).replace(/\\/g, '/')}`);
