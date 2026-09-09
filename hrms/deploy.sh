#!/bin/bash

echo "🚀 Starting deployment..."

echo "📥 Pulling latest code from GitHub..."
git fetch origin
git reset --hard origin/main

echo "🔧 Installing backend dependencies..."
cd back-end
npm install

echo "♻️ Restarting backend..."
pm2 restart rigweda-api

echo "🎨 Building frontend..."
cd ../front-end
npm install
npm run build

echo "📂 Copying frontend build to nginx folder..."
sudo rm -rf /var/www/rigwedahr/*
sudo cp -r dist/* /var/www/rigwedahr/

echo "🔑 Fixing permissions..."
sudo chown -R www-data:www-data /var/www/rigwedahr

echo "🔄 Reloading nginx..."
sudo systemctl reload nginx

echo "✅ Deployment completed!"