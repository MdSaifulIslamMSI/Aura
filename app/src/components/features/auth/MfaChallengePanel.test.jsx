import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntlProvider } from 'react-intl';
import MfaChallengePanel from './MfaChallengePanel';

const renderPanel = (panel) => render(
  <IntlProvider locale="en" messages={{}}>
    {panel}
  </IntlProvider>
);

const buildChallenge = (overrides = {}) => ({
  challengeId: 'mfa-challenge-1',
  purpose: 'login',
  action: '',
  allowedMethods: ['totp', 'passkey', 'recovery_code'],
  preferredMethod: 'totp',
  ...overrides,
});

const buildCompleteSessionResponse = () => ({
  success: true,
  status: 'authenticated',
  session: { sessionId: 'session-1' },
  profile: { id: 'profile-1' },
  roles: { isAdmin: false },
});

describe('MfaChallengePanel', () => {
  it('focuses the public heading and submits the offered TOTP challenge contract', async () => {
    const onVerifyTotp = vi.fn().mockResolvedValue(buildCompleteSessionResponse());

    renderPanel(
      <MfaChallengePanel
        challenge={buildChallenge()}
        onVerifyTotp={onVerifyTotp}
        onVerifyPasskey={vi.fn()}
        onVerifyRecoveryCode={vi.fn()}
      />
    );

    const heading = screen.getByRole('heading', { name: /confirm it's you/i });
    await waitFor(() => expect(heading).toHaveFocus());

    fireEvent.change(screen.getByLabelText(/6-digit authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    await waitFor(() => {
      expect(onVerifyTotp).toHaveBeenCalledWith({
        challengeId: 'mfa-challenge-1',
        purpose: 'login',
        action: '',
        code: '123456',
      });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/verification complete/i);
  });

  it('runs passkey verification without adding a code field', async () => {
    let finishPasskey;
    const onVerifyPasskey = vi.fn().mockImplementation(() => new Promise((resolve) => {
      finishPasskey = resolve;
    }));

    renderPanel(
      <MfaChallengePanel
        challenge={buildChallenge({ preferredMethod: 'passkey' })}
        onVerifyTotp={vi.fn()}
        onVerifyPasskey={onVerifyPasskey}
        onVerifyRecoveryCode={vi.fn()}
      />
    );

    expect(screen.queryByLabelText(/authenticator code/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try another way/i }));
    const totpAlternative = screen.getByRole('button', { name: /use authenticator app/i });
    fireEvent.click(screen.getByRole('button', { name: /continue with passkey/i }));
    expect(screen.getByRole('button', { name: /waiting for passkey/i })).toBeDisabled();
    expect(totpAlternative).toBeDisabled();

    await waitFor(() => {
      expect(onVerifyPasskey).toHaveBeenCalledWith({
        challengeId: 'mfa-challenge-1',
        purpose: 'login',
        action: '',
      });
    });
    finishPasskey(buildCompleteSessionResponse());
    expect(await screen.findByRole('status')).toHaveTextContent(/verification complete/i);
  });

  it('switches to recovery code and announces verification errors with focus', async () => {
    const rejection = Object.assign(new Error('Recovery code rejected'), { status: 401 });
    const onVerifyRecoveryCode = vi.fn().mockRejectedValue(rejection);

    renderPanel(
      <MfaChallengePanel
        challenge={buildChallenge()}
        onVerifyTotp={vi.fn()}
        onVerifyPasskey={vi.fn()}
        onVerifyRecoveryCode={onVerifyRecoveryCode}
      />
    );

    const methodToggle = screen.getByRole('button', { name: /try another way/i });
    expect(methodToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(methodToggle);
    expect(methodToggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /use recovery code/i }));

    const recoveryInput = screen.getByLabelText(/^recovery code$/i);
    await waitFor(() => expect(recoveryInput).toHaveFocus());
    fireEvent.change(recoveryInput, { target: { value: 'RECOVERY-ABCD' } });
    fireEvent.click(screen.getByRole('button', { name: /verify recovery code/i }));

    await waitFor(() => {
      expect(onVerifyRecoveryCode).toHaveBeenCalledWith({
        challengeId: 'mfa-challenge-1',
        purpose: 'login',
        action: '',
        code: 'RECOVERY-ABCD',
      });
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not accepted or has expired/i);
    expect(alert).toHaveFocus();
  });

  it('offers safe exit and sign-out actions without claiming admin context', async () => {
    const onCancel = vi.fn();
    const onSignOut = vi.fn().mockResolvedValue(null);

    renderPanel(
      <MfaChallengePanel
        challenge={buildChallenge({ allowedMethods: ['totp'] })}
        onVerifyTotp={vi.fn()}
        onCancel={onCancel}
        onSignOut={onSignOut}
      />
    );

    expect(screen.queryByText(/admin security checkpoint/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /return to storefront/i }));
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
  });

  it('explains the blocked admin recovery path without suggesting a retry loop', () => {
    const onCancel = vi.fn();

    renderPanel(
      <MfaChallengePanel
        challenge={null}
        policy={{
          audience: 'admin',
          allowedMethods: [],
          reason: 'admin_policy',
          requiredAssurance: 'mfa',
          nextAssurance: 'admin_passkey',
        }}
        isAdmin
        blocked
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/admin access remains locked/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/restore a passkey or mfa method/i);
    expect(screen.queryByText(/verification request is short-lived/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sign out and leave admin/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables verification for the Retry-After countdown and announces when retry is available', async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error('Rate limited'), {
      status: 429,
      retryAfterSeconds: 3,
    });
    const onVerifyTotp = vi.fn().mockRejectedValue(rateLimitError);

    try {
      renderPanel(
        <MfaChallengePanel
          challenge={buildChallenge()}
          onVerifyTotp={onVerifyTotp}
          onVerifyPasskey={vi.fn()}
          onVerifyRecoveryCode={vi.fn()}
        />
      );

      fireEvent.change(screen.getByLabelText(/6-digit authenticator code/i), {
        target: { value: '123456' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /verify code/i }));
        await Promise.resolve();
      });

      expect(screen.getByRole('alert')).toHaveTextContent(/temporarily paused/i);
      expect(screen.getByRole('button', { name: /try again in 3 seconds/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /try another way/i })).toBeDisabled();

      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('button', { name: /try again in 2 seconds/i })).toBeDisabled();

      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('button', { name: /try again in 1 second/i })).toBeDisabled();

      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('button', { name: /verify code/i })).toBeEnabled();
      expect(screen.getByRole('status')).toHaveTextContent(/try verification again now/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders safe action, policy, assurance, and expiry context, then blocks an expired challenge', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));

    try {
      renderPanel(
        <MfaChallengePanel
          challenge={buildChallenge({
            purpose: 'step_up',
            action: 'delete_account<script>',
            reason: 'dangerous_action',
            requiredStrength: 'passkey',
            expiresIn: 2,
            preferredMethod: 'passkey',
          })}
          onVerifyTotp={vi.fn()}
          onVerifyPasskey={vi.fn()}
          onVerifyRecoveryCode={vi.fn()}
        />
      );

      const context = screen.getByLabelText(/verification context/i);
      expect(context).toHaveTextContent(/protected account security action/i);
      expect(context).toHaveTextContent(/sensitive action requires fresh verification/i);
      expect(context).toHaveTextContent(/passkey verification required/i);
      expect(context).toHaveTextContent(/expires in 2 seconds/i);
      expect(context).not.toHaveTextContent(/delete_account|script/i);

      act(() => vi.advanceTimersByTime(1000));
      expect(context).toHaveTextContent(/expires in 1 second/i);
      act(() => vi.advanceTimersByTime(1000));

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/verification request has expired/i);
      expect(alert).toHaveFocus();
      expect(screen.getByRole('button', { name: /continue with passkey/i })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a recoverable session error instead of an indefinite completion state', async () => {
    const onVerifyTotp = vi.fn().mockResolvedValue({
      success: true,
      session: { sessionId: 'session-1' },
    });

    renderPanel(
      <MfaChallengePanel
        challenge={buildChallenge({ allowedMethods: ['totp'] })}
        onVerifyTotp={onVerifyTotp}
        onSignOut={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/6-digit authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: /verify code/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/authenticated session could not be confirmed/i);
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByText(/finishing your session/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify code/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeEnabled();
  });
});
