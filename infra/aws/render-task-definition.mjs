import fs from 'node:fs/promises';
import path from 'node:path';

const cwd = process.cwd();
const templatePath = path.resolve(cwd, process.env.ECS_TASK_TEMPLATE || 'infra/aws/ecs-task-definition.template.json');
const outputPath = path.resolve(cwd, process.env.ECS_TASK_OUTPUT || 'infra/aws/ecs-task-definition.rendered.json');

const requiredEnv = [
    'AWS_REGION',
    'AWS_ACCOUNT_ID',
    'AWS_ECR_REPOSITORY',
    'FRONTEND_ORIGIN',
    'APP_PUBLIC_URL',
    'REVIEW_UPLOAD_S3_BUCKET',
    'ECS_TASK_EXECUTION_ROLE_ARN',
    'ECS_TASK_ROLE_ARN',
    'MONGO_URI_SECRET_ARN',
    'REDIS_URL_SECRET_ARN',
    'BYTEZ_API_KEY_SECRET_ARN',
    'UPLOAD_SIGNING_SECRET_SECRET_ARN',
];

const getEnv = (name, fallback = '') => String(process.env[name] || fallback).trim();

const missing = requiredEnv.filter((name) => !getEnv(name));
if (missing.length > 0) {
    throw new Error(`Missing required env for ECS task rendering: ${missing.join(', ')}`);
}

const replacements = {
    '__AWS_REGION__': getEnv('AWS_REGION'),
    '__AWS_ACCOUNT_ID__': getEnv('AWS_ACCOUNT_ID'),
    '__AWS_ECR_REPOSITORY__': getEnv('AWS_ECR_REPOSITORY'),
    '__FRONTEND_ORIGIN__': getEnv('FRONTEND_ORIGIN'),
    '__APP_PUBLIC_URL__': getEnv('APP_PUBLIC_URL'),
    '__REVIEW_UPLOAD_S3_BUCKET__': getEnv('REVIEW_UPLOAD_S3_BUCKET'),
    '__REVIEW_UPLOAD_S3_PREFIX__': getEnv('REVIEW_UPLOAD_S3_PREFIX', 'reviews'),
    '__REVIEW_UPLOAD_PUBLIC_BASE_URL__': getEnv('REVIEW_UPLOAD_PUBLIC_BASE_URL'),
    '__ECS_TASK_EXECUTION_ROLE_ARN__': getEnv('ECS_TASK_EXECUTION_ROLE_ARN'),
    '__ECS_TASK_ROLE_ARN__': getEnv('ECS_TASK_ROLE_ARN'),
    '__MONGO_URI_SECRET_ARN__': getEnv('MONGO_URI_SECRET_ARN'),
    '__REDIS_URL_SECRET_ARN__': getEnv('REDIS_URL_SECRET_ARN'),
    '__BYTEZ_API_KEY_SECRET_ARN__': getEnv('BYTEZ_API_KEY_SECRET_ARN'),
    '__UPLOAD_SIGNING_SECRET_SECRET_ARN__': getEnv('UPLOAD_SIGNING_SECRET_SECRET_ARN'),
};

let rendered = await fs.readFile(templatePath, 'utf8');
for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
}

await fs.writeFile(outputPath, `${rendered.trim()}\n`, 'utf8');
console.log(`Rendered ECS task definition to ${outputPath}`);
