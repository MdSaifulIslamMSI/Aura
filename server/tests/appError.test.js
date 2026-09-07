const AppError = require('../utils/AppError');

describe('AppError', () => {
  test('carries messages with status codes', () => {
    const error = new AppError('Not found', 404);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Not found');
    expect(error.statusCode).toBe(404);
    expect(error.isOperational).toBe(true);
  });

  test('classifies 4xx as fail and 5xx as error', () => {
    expect(new AppError('Bad input', 400).status).toBe('fail');
    expect(new AppError('Denied', 403).status).toBe('fail');
    expect(new AppError('Boom', 500).status).toBe('error');
  });

  test('captures stack traces', () => {
    const error = new AppError('x', 500);
    expect(typeof error.stack).toBe('string');
    expect(error.stack.length).toBeGreaterThan(0);
  });
});
