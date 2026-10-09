FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install -g @nestjs/cli typescript
RUN npm install && npm install --save-dev @types/node
COPY . .
RUN npx nest build
CMD ["node", "dist/main"]
