import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import type {Plugin} from 'vite';
import {defineConfig} from 'vite';

function veloCoreTxtStoragePlugin(): Plugin {
  const workoutsPath = path.resolve(__dirname, 'public', 'workouts.txt');
  const riderProfilePath = path.resolve(__dirname, 'public', 'rider-profile.txt');

  return {
    name: 'velocore-txt-storage',
    configureServer(server) {
      server.middlewares.use('/api/workouts-txt', (req, res, next) => {
        if (req.method === 'GET') {
          try {
            const content = fs.existsSync(workoutsPath)
              ? fs.readFileSync(workoutsPath, 'utf-8')
              : '';
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.statusCode = 200;
            res.end(content);
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              fs.mkdirSync(path.dirname(workoutsPath), {recursive: true});
              fs.writeFileSync(workoutsPath, body, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ok: true, path: 'public/workouts.txt'}));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ok: false, error: String(err)}));
            }
          });
          return;
        }
        next();
      });

      server.middlewares.use('/api/rider-profile-txt', (req, res, next) => {
        if (req.method === 'GET') {
          try {
            const content = fs.existsSync(riderProfilePath)
              ? fs.readFileSync(riderProfilePath, 'utf-8')
              : '';
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.statusCode = 200;
            res.end(content);
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              fs.mkdirSync(path.dirname(riderProfilePath), {recursive: true});
              fs.writeFileSync(riderProfilePath, body, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ok: true, path: 'public/rider-profile.txt'}));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ok: false, error: String(err)}));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), veloCoreTxtStoragePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
