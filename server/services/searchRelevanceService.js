const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.resolve(process.cwd(), '..', 'docs', 'reports', 'search-relevance.latest.json');
const DEFAULT_CORPUS_PATH = path.resolve(process.cwd(), '..', 'docs', 'search-benchmark.seeded.json');

const ensureReportDir = async () => {
    await fs.promises.mkdir(path.dirname(REPORT_PATH), { recursive: true });
};

const loadSeededSearchCorpus = async (filePath = DEFAULT_CORPUS_PATH) => {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
};

const writeLatestSearchRelevanceReport = async (report, filePath = REPORT_PATH) => {
    await ensureReportDir();
    await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2));
    return filePath;
};

const readLatestSearchRelevanceReport = async (filePath = REPORT_PATH) => {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
};

module.exports = {
    REPORT_PATH,
    DEFAULT_CORPUS_PATH,
    loadSeededSearchCorpus,
    writeLatestSearchRelevanceReport,
    readLatestSearchRelevanceReport,
};
