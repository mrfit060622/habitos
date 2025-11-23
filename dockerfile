# -----------------------------
# Imagem base Node
# -----------------------------
FROM node:18-alpine

# Criar diretório da app
WORKDIR /app

# Copiar package.json e instalar deps
COPY package*.json ./
RUN npm install --production

# Copiar o restante do código
COPY . .

# Configurar timezone para o Brasil (cron depende do horário)
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

# Porta "dummy" — bot não usa HTTP, mas Fly exige
EXPOSE 8080

# Comando de inicialização
CMD ["node", "index.js"]
