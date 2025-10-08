# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Install serve to host the static build
RUN npm install -g serve

# Copy build output
COPY --from=build /app/dist ./dist

# Expose port 8080
EXPOSE 8080

# Start the frontend on all interfaces
CMD ["serve", "-s", "dist", "-l", "8080", "--single"]
