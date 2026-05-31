# Local SonarQube

## Start SonarQube

Create an untracked `infra/sonarqube/.env` from `infra/sonarqube/.env.example`, replace the placeholder password, then run:

```sh
docker compose --env-file infra/sonarqube/.env -f infra/sonarqube/docker-compose.yml up -d
```

Open `http://localhost:9000`, complete the first-login password change, create the `aura` project, and generate a project analysis token. Never commit the token.

## Run analysis

The Sonar scanner runs from SonarSource's pinned Docker image. For a scanner container to reach local SonarQube, use `host.docker.internal`:

```powershell
$env:SONAR_HOST_URL = "http://host.docker.internal:9000"
$env:SONAR_TOKEN = "<local-project-token>"
npm run quality:coverage
npm run quality:sonar
```

`sonar-project.properties` imports `server/coverage/lcov.info` and `app/coverage/lcov.info`, excludes generated and dependency folders, and waits for the quality gate result.

## CI options

1. Use SonarCloud or another hosted Sonar-compatible endpoint.
2. Run self-hosted SonarQube on a network reachable from GitHub-hosted runners.
3. Use a self-hosted GitHub runner inside the SonarQube network.

Configure repository secrets `SONAR_HOST_URL` and `SONAR_TOKEN`. Fork pull requests do not receive these secrets.
