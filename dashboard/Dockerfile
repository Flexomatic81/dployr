FROM node:20-alpine

WORKDIR /app

# Install Docker CLI, Compose Plugin, Git, Bash, and database clients for backup/restore
RUN apk add --no-cache docker-cli docker-cli-compose git bash mariadb-client postgresql-client && \
    git config --global --add safe.directory '*'

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Version info as build argument (passed during build)
ARG GIT_HASH=unknown
ARG GIT_DATE=unknown
ARG GIT_TAG=
RUN echo "{\"hash\":\"${GIT_HASH}\",\"date\":\"${GIT_DATE}\",\"tag\":\"${GIT_TAG}\"}" > /app/version.json

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
