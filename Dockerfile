FROM node:20-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    fontconfig \
    fonts-roboto \
    fonts-open-sans \
    fonts-noto \
    fonts-noto-cjk \
    fonts-lato \
    fonts-liberation \
    fonts-dejavu-core \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Download additional Google Fonts not available via apt
RUN mkdir -p /usr/share/fonts/google && \
    cd /tmp && \
    for FONT in "Merriweather" "Montserrat" "Poppins" "Raleway" "Playfair+Display" "Oswald" \
                "Source+Sans+Pro" "Nunito" "EB+Garamond" "Libre+Baskerville" "Libre+Bodoni" \
                "Libre+Caslon+Text" "Libre+Franklin" "DM+Sans" "Roboto+Slab"; do \
      curl -sL "https://fonts.google.com/download?family=${FONT}" -o font.zip 2>/dev/null && \
      unzip -o -q font.zip -d /usr/share/fonts/google/ 2>/dev/null; \
      rm -f font.zip; \
    done && \
    fc-cache -f -v > /dev/null 2>&1

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
