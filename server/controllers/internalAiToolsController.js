const { z } = require('zod');
const { runInternalAiTool } = require('../services/intelligence/intelligenceToolService');

const internalAiToolSchema = z.object({
    toolName: z.string().trim().min(1).max(120),
    input: z.object({}).passthrough().optional(),
    authContext: z.object({
        actorUserId: z.string().trim().max(120).optional(),
        isAdmin: z.boolean().optional(),
    }).passthrough().optional(),
}).strict();

const runAiTool = async (req, res) => {
    const parsed = internalAiToolSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({
            status: 'error',
            message: 'Invalid internal AI tool payload.',
            requestId: req.requestId || '',
            errors: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        });
    }

    const result = await runInternalAiTool(parsed.data);
    return res.json({
        success: true,
        requestId: req.requestId || '',
        ...result,
    });
};

module.exports = {
    runAiTool,
};
