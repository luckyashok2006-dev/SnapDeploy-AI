import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ProjectWorkspace } from '../types/workspace';

export async function exportProjectAsZip(workspace: ProjectWorkspace) {
  const zip = new JSZip();
  const folderName = workspace.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const projectFolder = zip.folder(folderName) || zip;

  // Add all VFS files
  Object.values(workspace.files).forEach(file => {
    const relativePath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
    projectFolder.file(relativePath, file.content);
  });

  // Add production Dockerfile if not present
  if (!workspace.files['/Dockerfile']) {
    projectFolder.file('Dockerfile', `# Production Multi-Stage Dockerfile for ${workspace.title}
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["npm", "start"]
`);
  }

  // Add .dockerignore
  projectFolder.file('.dockerignore', `node_modules
dist
.git
.env*.local
`);

  // Add .gitignore
  projectFolder.file('.gitignore', `# Dependencies
/node_modules
/.pnp
.pnp.js

# Production
/dist
/build
/.next/

# Environment Variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
`);

  // Add comprehensive README.md
  projectFolder.file('README.md', `# ${workspace.title}

> Autonomous Full-Stack Application Synthesized & Verified by **SnapDeploy AI**

## 🚀 Overview
${workspace.description}

- **Badge / Category:** ${workspace.badge}
- **VFS Timestamp:** ${new Date().toISOString()}

---

## 🛠️ Tech Stack & Prerequisites
- Node.js \`>= 20.0.0\`
- npm \`>= 10.0.0\`

---

## 📦 Getting Started

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Database Setup (Prisma SQLite)
\`\`\`bash
npx prisma generate
npx prisma db push
\`\`\`

### 3. Run Development Server
\`\`\`bash
npm run dev
\`\`\`
Visit [http://localhost:3000](http://localhost:3000) to inspect the live application.

---

## 🐳 Docker Deployment
\`\`\`bash
docker build -t snapdeploy-${workspace.id}:latest .
docker run -p 3000:3000 snapdeploy-${workspace.id}:latest
\`\`\`
`);

  const blob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  saveAs(blob, `${folderName}.zip`);
}
