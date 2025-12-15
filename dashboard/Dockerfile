FROM node:20-alpine

WORKDIR /app

# Docker CLI, Compose Plugin und Git installieren
RUN apk add --no-cache docker-cli docker-cli-compose git

# Package files kopieren
COPY package*.json ./

# Dependencies installieren
RUN npm install --production

# App-Code kopieren
COPY . .

# Port freigeben
EXPOSE 3000

# App starten
CMD ["npm", "start"]
