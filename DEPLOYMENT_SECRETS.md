# Security Secrets Management Guide

**⚠️ CRITICAL**: Never commit secrets to version control. All credentials must be stored securely in deployment platforms.

---

## 📋 Required Secrets

### **Backend (Node.js) Secrets**

#### 1. Firebase Configuration
- **Key**: `FIREBASE_PROJECT_ID`
- **Description**: Firebase project identifier for authentication
- **Example**: `billy-b674c`
- **Location**: Used in `server/config/firebase.js`
- **Instructions**: 
  1. Get from Firebase Console → Project Settings → Project ID
  2. Set as environment variable in all deployments

#### 2. Gmail OTP Delivery
- **Key**: `GMAIL_USER`
- **Description**: Gmail address for sending OTP emails
- **Example**: `your-service-email@gmail.com`
- **Location**: Used in `server/config/emailFlags.js`
- **Instructions**:
  1. Create Gmail account (or use service account)
  2. Enable 2-Factor Authentication
  3. Go to `https://myaccount.google.com/apppasswords`
  4. Generate "Mail" app password (16 characters)

- **Key**: `GMAIL_APP_PASSWORD`
- **Description**: Gmail app-specific password (NOT your main Gmail password)
- **Example**: `dfvrfhpdggcunhgw` (format is always 16 chars)
- **⚠️ WARNING**: This is different from your Gmail password
- **Instructions**:
  1. Never use your actual Gmail password
  2. Always generate via App Passwords page
  3. Regenerate if ever exposed

#### 3. LiveKit Video Configuration
- **Key**: `LIVEKIT_API_SECRET`
- **Description**: LiveKit API secret for room token generation
- **Example**: `3jg2a5bFO1ZvvLx8mEjCddPdOxVPwpR6TUL3Z7HhMpG`
- **Location**: Used in `server/config/livekit.js`
- **Instructions**:
  1. Get from LiveKit Cloud Console → Settings → API Keys
  2. Copy the secret (not the API key)
  3. Rotate every 90 days

#### 4. AI Provider Keys
- **Key**: `GROQ_API_KEY`
- **Description**: Groq API key for LLM inference
- **Location**: Used in `server/config/aiFlags.js`
- **Instructions**: Get from `https://console.groq.com/keys`

- **Key**: `OPENAI_API_KEY`
- **Description**: OpenAI API key (if using OpenAI models)
- **Instructions**: Get from `https://platform.openai.com/api-keys`

- **Key**: `VOYAGE_API_KEY`
- **Description**: Voyage AI key for embeddings
- **Instructions**: Get from Voyage AI dashboard

- **Key**: `ELEVENLABS_API_KEY`
- **Description**: ElevenLabs key for text-to-speech
- **Instructions**: Get from `https://elevenlabs.io/app/settings/api-keys`

#### 5. Database & Infrastructure
- **Key**: `MONGO_URI`
- **Description**: MongoDB connection string
- **Format**: `mongodb+srv://user:password@cluster.mongodb.net/database?authSource=admin`
- **Instructions**: Get from MongoDB Atlas → Connect → Connection String
- **⚠️ WARNING**: Contains username and password - handle carefully

- **Key**: `REDIS_URL`
- **Description**: Redis connection URL (if enabled)
- **Format**: `redis://username:password@host:port`
- **Instructions**: Get from Upstash or self-hosted Redis

### **Frontend (React) Secrets**

#### 1. Firebase Configuration (Public, but parameterized)
- **Key**: `VITE_FIREBASE_PROJECT_ID`
- **Description**: Firebase project ID (safe to be public)
- **Example**: `billy-b674c`
- **Location**: Used in `app/src/config/firebase.js`
- **Note**: This is NOT a secret - it's in client code

- **Key**: `VITE_FIREBASE_API_KEY`
- **Description**: Firebase API key (safe to be public)
- **Instructions**: Get from Firebase Console → Project Settings

- **Key**: `VITE_FIREBASE_AUTH_DOMAIN`
- **Description**: Firebase auth domain (safe to be public)
- **Example**: `billy-b674c.firebaseapp.com`

- **Key**: `VITE_FIREBASE_PROJECT_ID` (frontend version)
- **Description**: Frontend needs the same Firebase project ID
- **Instructions**: Same as backend `FIREBASE_PROJECT_ID`

---

## 🚀 Deployment Platforms

### **Render.com Backend Deployment**

1. **Connect Git Repository**
   - Go to `https://dashboard.render.com`
   - Click "New +" → "Web Service"
   - Select your GitHub repository
   - Choose `server` as root directory

2. **Set Environment Variables**
   ```
   Settings → Environment → Environment Variables
   ```

3. **Add Secrets** (Click "Add Secret" for sensitive values):
   ```
   Firebase_PROJECT_ID = billy-b674c
   GMAIL_USER = your-email@gmail.com
   GMAIL_APP_PASSWORD = xxxxyyyyyzzzzwwww
   LIVEKIT_API_SECRET = xxxxxxxxxxxxx
   MONGO_URI = mongodb+srv://user:pass@cluster...
   GROQ_API_KEY = gsk_xxxxxxxxxxxxx
   OPENAI_API_KEY = sk-xxxxxxxxxxxxx
   VOYAGE_API_KEY = pa-xxxxxxxxxxxxx
   ELEVENLABS_API_KEY = sk_xxxxxxxxxxxxx
   ```

4. **Automatic Redeployment**
   - Render auto-redeploys when environment variables change
   - No need to push code again

### **Vercel Frontend Deployment**

1. **Connect Git Repository**
   - Go to `https://vercel.com`
   - Import project
   - Choose `app` as root directory

2. **Set Environment Variables**
   ```
   Settings → Environment Variables
   ```

3. **Add Secrets**:
   ```
   VITE_FIREBASE_PROJECT_ID = billy-b674c
   VITE_FIREBASE_API_KEY = AIzaSyB...
   VITE_FIREBASE_AUTH_DOMAIN = billy-b674c.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID = billy-b674c
   VITE_FIREBASE_STORAGE_BUCKET = billy-b674c.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID = xxxxx
   VITE_FIREBASE_APP_ID = 1:xxxx:web:xxx
   VITE_API_URL = https://api.example.com/api
   ```

4. **Note**: Frontend env vars are NOT secrets (they're in client code)
   - Only mark sensitive keys (like API keys) as "Sensitive"

### **GitHub Secrets (for CI/CD)**

For GitHub Actions workflows:

1. **Go to Repository Settings**
   ```
   Settings → Secrets and variables → Actions → New repository secret
   ```

2. **Add Secrets**:
   ```
   FIREBASE_PROJECT_ID
   GMAIL_USER
   GMAIL_APP_PASSWORD
   MONGO_URI
   RENDER_API_KEY (for Render deployments)
   VERCEL_TOKEN (for Vercel deployments)
   ```

3. **Usage in Workflows**:
   ```yaml
   - name: Deploy to Render
     env:
       FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
   ```

---

## 🔒 Secret Rotation Schedule

| Secret | Rotation | Reason |
|--------|----------|--------|
| `GMAIL_APP_PASSWORD` | 90 days | Compliance, reduce breach impact |
| `LIVEKIT_API_SECRET` | 90 days | Security best practice |
| `GROQ_API_KEY` | 180 days | Monitor for unusual usage |
| `OPENAI_API_KEY` | 180 days | Monitor for unusual usage |
| `MONGO_URI` (password) | 180 days | Database security |
| `Firebase credentials` | As needed | If compromised |

**Rotation Process**:
1. Generate new secret in service provider
2. Update all deployment platforms
3. Monitor logs for new secret usage
4. Revoke old secret in provider
5. Document rotation in security log

---

## ⚠️ Security Best Practices

1. **Never Commit Secrets**
   ```bash
   # WRONG - Don't do this
   git add .env
   git commit -m "add secrets"
   
   # RIGHT - Add to .gitignore
   echo ".env" >> .gitignore
   echo ".env.local" >> .gitignore
   ```

2. **Use .env.example for Documentation**
   ```bash
   # GOOD - Shows what secrets are needed
   FIREBASE_PROJECT_ID=your-firebase-project-id
   GMAIL_USER=your-email@gmail.com
   GMAIL_APP_PASSWORD=your-gmail-app-password
   ```

3. **Separate Local and Production Secrets**
   ```bash
   # Local development
   .env.local (git ignored)
   
   # Production (managed by deployment platform)
   Render Environment Variables
   Vercel Environmental Variables
   ```

4. **Audit Secret Access**
   - Enable audit logging on all services
   - Monitor for unusual API key usage
   - Set up alerts for failed authentication attempts

5. **Immediate Actions if Compromised**
   ```bash
   # 1. Revoke compromised secret in service provider
   # 2. Generate new secret immediately
   # 3. Update deployment platform env vars
   # 4. Monitor logs for malicious usage
   # 5. Rotate other related secrets
   # 6. Document incident
   ```

6. **Local Development Setup**
   ```bash
   # 1. Create .env.local from .env.example
   cp server/.env.example server/.env.local
   
   # 2. Fill in actual values
   FIREBASE_PROJECT_ID=...
   GMAIL_USER=...
   # etc
   
   # 3. Never commit .env.local
   git status # verify .env.local is not staged
   ```

---

## 📝 Checklist for First-Time Setup

- [ ] Create `.env.example` with placeholder values
- [ ] Add `.env`, `.env.local`, `.env.*.local` to `.gitignore`
- [ ] Get Firebase Project ID from Firebase Console
- [ ] Generate Gmail App Password from Google Account
- [ ] Get LiveKit API Secret from LiveKit Console
- [ ] Get AI provider API keys (Groq, OpenAI, etc)
- [ ] Get MongoDB connection string from Atlas
- [ ] Set all secrets in Render dashboard
- [ ] Set all secrets in Vercel dashboard
- [ ] Test deployment with new secrets
- [ ] Monitor logs for any "undefined secret" errors
- [ ] Document rotation schedule
- [ ] Set calendar reminders for rotation dates

---

## 🆘 Troubleshooting

### "Undefined environment variable"
**Cause**: Secret not set in deployment platform  
**Fix**: Add secret to Render/Vercel environment variables

### "CORS origin not allowed"
**Cause**: `CORS_ORIGIN` env var not set  
**Fix**: Set in Render as: `http://localhost:5173,https://your-domain.com`

### "Firebase project ID not found"
**Cause**: `FIREBASE_PROJECT_ID` not set in backend  
**Fix**: Add to Render environment variables

### "Gmail password rejected"
**Cause**: Using main Gmail password instead of app password  
**Fix**: Generate new app password at `https://myaccount.google.com/apppasswords`

### "MongoDB connection refused"
**Cause**: `MONGO_URI` incorrect or IP not whitelisted  
**Fix**: 
1. Check connection string format
2. Whitelist deployment IP in MongoDB Atlas

---

## 📞 Support

For issues with secrets:
1. Check `.env.example` for required variables
2. Verify secret is set in deployment platform
3. Check deployment logs for error messages
4. Rotate suspect secrets immediately
5. Contact security team

---

**Last Updated**: March 16, 2026  
**Status**: Active  
**Owner**: Security Team
