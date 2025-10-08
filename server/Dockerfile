# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Use npm ci for production builds (faster and more reliable)
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose the port your app runs on
EXPOSE 8081

# Set NODE_ENV to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]