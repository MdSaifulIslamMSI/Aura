# Network Reset Instructions

The automated network reset failed because it requires **Administrator Privileges**.

Please follow these steps manually:

1.  Press `Win + X` and select **Windows PowerShell (Admin)** or **Command Prompt (Admin)**.
2.  Copy and paste the following commands one by one (or all at once):

```powershell
netsh winsock reset
netsh int ip reset
ipconfig /release
ipconfig /renew
ipconfig /flushdns
```

3.  **Restart your computer** immediately.

This will fully reset your internet connection and ISP settings on your local machine.
