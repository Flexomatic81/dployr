FROM node:20-alpine

WORKDIR /app

# Docker CLI, Compose Plugin, Git und Bash installieren
RUN apk add --no-cache docker-cli docker-cli-compose git bash

# Package files kopieren
COPY package*.json ./

# Dependencies installieren
RUN npm install --production

# App-Code kopieren
COPY . .

# Version-Info als Build-Argument (wird beim Build übergeben)
ARG GIT_HASH=unknown
ARG GIT_DATE=unknown
RUN echo "{\"hash\":\"${GIT_HASH}\",\"date\":\"${GIT_DATE}\"}" > /app/version.json

# Port freigeben
EXPOSE 3000

# App starten
CMD ["npm", "start"]
