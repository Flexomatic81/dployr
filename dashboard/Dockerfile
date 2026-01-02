FROM node:20-alpine

WORKDIR /app

# Install Docker CLI, Compose Plugin, Git and Bash
RUN apk add --no-cache docker-cli docker-cli-compose git bash

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Version info as build argument (passed during build)
ARG GIT_HASH=unknown
ARG GIT_DATE=unknown
RUN echo "{\"hash\":\"${GIT_HASH}\",\"date\":\"${GIT_DATE}\"}" > /app/version.json

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
