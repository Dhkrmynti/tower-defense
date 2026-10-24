import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

function adminSavePlugin() {
  return {
    name: 'admin-save-plugin',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const url = req.url || ''

        // 1. GET /api/admin/config
        if (url === '/api/admin/config' && req.method === 'GET') {
          try {
            const envPath = path.resolve(process.cwd(), '.env')
            let tokenAddress = ''
            let privateKey = ''
            let treasuryAddress = ''

            if (fs.existsSync(envPath)) {
              const envContent = fs.readFileSync(envPath, 'utf-8')
              const tokenMatch = envContent.match(/VITE_TOKEN_ADDRESS=["']?([^"'\r\n]+)["']?/)
              const keyMatch = envContent.match(/CREATOR_PRIVATE_KEY=["']?([^"'\r\n]+)["']?/)
              const treasuryMatch = envContent.match(/(?:TREASURY_ADDRESS|VITE_CREATOR_ADDRESS)=["']?([^"'\r\n]+)["']?/)
              if (tokenMatch) tokenAddress = tokenMatch[1]
              if (keyMatch) privateKey = keyMatch[1]
              if (treasuryMatch) treasuryAddress = treasuryMatch[1]
            }

            const configPath = path.resolve(process.cwd(), 'bot-config.json')
            if (fs.existsSync(configPath)) {
              try {
                const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
                if (saved.tokenAddress && !tokenAddress) tokenAddress = saved.tokenAddress
                if (saved.privateKey && !privateKey) privateKey = saved.privateKey
                if (saved.treasuryAddress && !treasuryAddress) treasuryAddress = saved.treasuryAddress
              } catch (e) {}
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            // The key never goes back over HTTP; the admin form only ever writes it
            res.end(JSON.stringify({ success: true, tokenAddress, privateKey: '', hasPrivateKey: !!privateKey, treasuryAddress }))
            return
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
            return
          }
        }

        // 2. POST /api/admin/save
        if (url === '/api/admin/save' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: any) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}')
              const envPath = path.resolve(process.cwd(), '.env')
              let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''

              if (data.tokenAddress !== undefined) {
                if (envContent.includes('VITE_TOKEN_ADDRESS=')) {
                  envContent = envContent.replace(/VITE_TOKEN_ADDRESS=.*/g, `VITE_TOKEN_ADDRESS="${data.tokenAddress}"`)
                } else {
                  envContent += `\nVITE_TOKEN_ADDRESS="${data.tokenAddress}"`
                }
              }

              if (data.privateKey !== undefined) {
                if (envContent.includes('CREATOR_PRIVATE_KEY=')) {
                  envContent = envContent.replace(/CREATOR_PRIVATE_KEY=.*/g, `CREATOR_PRIVATE_KEY="${data.privateKey}"`)
                } else {
                  envContent += `\nCREATOR_PRIVATE_KEY="${data.privateKey}"`
                }
              }

              if (data.treasuryAddress !== undefined) {
                if (envContent.includes('TREASURY_ADDRESS=')) {
                  envContent = envContent.replace(/TREASURY_ADDRESS=.*/g, `TREASURY_ADDRESS="${data.treasuryAddress}"`)
                } else {
                  envContent += `\nTREASURY_ADDRESS="${data.treasuryAddress}"`
                }
                if (envContent.includes('VITE_CREATOR_ADDRESS=')) {
                  envContent = envContent.replace(/VITE_CREATOR_ADDRESS=.*/g, `VITE_CREATOR_ADDRESS="${data.treasuryAddress}"`)
                } else {
                  envContent += `\nVITE_CREATOR_ADDRESS="${data.treasuryAddress}"`
                }
              }

              if (data.creatorAddress) {
                if (envContent.includes('VITE_CREATOR_ADDRESS=')) {
                  envContent = envContent.replace(/VITE_CREATOR_ADDRESS=.*/g, `VITE_CREATOR_ADDRESS="${data.creatorAddress}"`)
                } else {
                  envContent += `\nVITE_CREATOR_ADDRESS="${data.creatorAddress}"`
                }
              }

              fs.writeFileSync(envPath, envContent, 'utf-8')

              // Update bot-config.json jika ada
              const configPath = path.resolve(process.cwd(), 'bot-config.json')
              let botConfig: any = {}
              if (fs.existsSync(configPath)) {
                try {
                  botConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
                } catch (e) {}
              }
              if (data.tokenAddress !== undefined) botConfig.tokenAddress = data.tokenAddress
              if (data.privateKey !== undefined) botConfig.privateKey = data.privateKey
              if (data.treasuryAddress !== undefined) botConfig.treasuryAddress = data.treasuryAddress
              fs.writeFileSync(configPath, JSON.stringify(botConfig, null, 2), 'utf-8')

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, message: 'Disimpan ke .env dan bot-config.json' }))
              return
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: err.message }))
              return
            }
          })
          return
        }

        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), adminSavePlugin()],
  server: { watch: { ignored: ['**/bot-*.json', '**/bot/**/*.json', '**/.env'] }, 
    host: '0.0.0.0',
    port: parseInt(process.env.WEB_PORT || "3095", 10),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || '5015'}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.WEB_PORT || "3095", 10),
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || '5015'}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        chunkFileNames: `assets/[name]-[hash]-${Date.now()}.js`,
        assetFileNames: `assets/[name]-[hash]-${Date.now()}.[ext]`
      }
    }
  }
})
