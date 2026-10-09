FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install -g @nestjs/cli typescript
RUN npm install --legacy-peer-deps
COPY . .
RUN npx nest build
CMD ["node", "dist/main"]
