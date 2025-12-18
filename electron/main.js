const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const iconv = require('iconv-lite')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 选择目录
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result.filePaths[0] || null
})

// 执行SVN命令
function execSvn(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(iconv.decode(stderr, 'cp936'))
      } else {
        resolve(iconv.decode(stdout, 'cp936'))
      }
    })
  })
}

// 获取SVN日志
ipcMain.handle('get-svn-log', async (event, { dirPath, days, author }) => {
  const date = new Date()
  date.setDate(date.getDate() - days)
  const dateStr = date.toISOString().split('T')[0]

  let cmd = `svn log -v -r {${dateStr}}:HEAD "${dirPath}"`
  console.log('执行命令:', cmd)

  try {
    const output = await execSvn(cmd, dirPath)
    console.log('SVN输出长度:', output.length)
    console.log('SVN输出前500字符:', output.substring(0, 500))
    const result = parseLog(output, author)
    console.log('解析结果数量:', result.length)
    return result
  } catch (e) {
    console.error('SVN错误:', e)
    throw new Error(e)
  }
})

// 解析SVN日志
function parseLog(output, authorFilter) {
  const entries = []
  // 统一换行符
  output = output.replace(/\r\n/g, '\n')
  const blocks = output.split(/^-{72}$/m).filter(b => b.trim())

  for (const block of blocks) {
    console.log('Block前100字符:', JSON.stringify(block.substring(0, 100)))
    const headerMatch = block.match(/r(\d+)\s*\|\s*(\S+)\s*\|\s*([^|]+)/)
    if (!headerMatch) {
      console.log('头部不匹配')
      continue
    }
    console.log('头部匹配成功:', headerMatch[1], headerMatch[2])

    const [, revision, author, dateStr] = headerMatch

    if (authorFilter && !author.toLowerCase().includes(authorFilter.toLowerCase())) {
      continue
    }

    const msgMatch = block.match(/(?:Changed paths:|改变的路径:)\s*\n([\s\S]*?)\n\n([\s\S]*)/)
    if (!msgMatch) {
      console.log('msgMatch失败，block内容:', JSON.stringify(block.substring(0, 300)))
      continue
    }
    console.log('msgMatch成功，文件数:', msgMatch[1].split('\n').length)

    const pathsSection = msgMatch[1]
    const message = msgMatch[2].trim()

    const files = []
    const pathLines = pathsSection.split('\n')
    for (const line of pathLines) {
      const fileMatch = line.match(/^\s*([AMDRU])\s+(.+)$/)
      if (fileMatch) {
        files.push({
          action: fileMatch[1],
          path: fileMatch[2].trim()
        })
      }
    }

    entries.push({
      revision,
      author,
      date: dateStr.trim(),
      message,
      files
    })
  }

  return entries
}

// 读取文件内容
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch (e) {
    return ''
  }
})

// 获取SVN文件特定版本内容
ipcMain.handle('get-svn-file', async (event, { filePath, revision }) => {
  try {
    const cmd = `svn cat -r ${revision} "${filePath}"`
    return await execSvn(cmd, path.dirname(filePath))
  } catch (e) {
    return ''
  }
})

// 写入文件
ipcMain.handle('write-file', async (event, filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf-8')
  return true
})

// 获取目录下所有文件
ipcMain.handle('list-files', async (event, dirPath) => {
  const files = []
  function walk(dir, relativePath = '') {
    const items = fs.readdirSync(dir)
    for (const item of items) {
      if (item === '.svn' || item === 'node_modules') continue
      const fullPath = path.join(dir, item)
      const relPath = relativePath ? `${relativePath}/${item}` : item
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath, relPath)
      } else {
        files.push({ path: relPath, fullPath })
      }
    }
  }
  try {
    walk(dirPath)
    return files
  } catch (e) {
    return []
  }
})
