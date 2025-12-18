<template>
  <div class="app">
    <!-- 顶部筛选条件 -->
    <div class="filter-bar">
      <div class="filter-item">
        <span>目录A：</span>
        <el-input v-model="dirA" style="width: 300px" readonly />
        <el-button @click="selectDir('A')">选择</el-button>
      </div>
      <div class="filter-item">
        <span>目录B：</span>
        <el-input v-model="dirB" style="width: 300px" readonly />
        <el-button @click="selectDir('B')">选择</el-button>
      </div>
      <div class="filter-item">
        <span>天数：</span>
        <el-input-number v-model="days" :min="1" :max="365" />
      </div>
      <div class="filter-item">
        <span>作者：</span>
        <el-input v-model="author" style="width: 150px" placeholder="可选" />
      </div>
      <div class="filter-item">
        <span>日志：</span>
        <el-input v-model="messageFilter" style="width: 150px" placeholder="模糊匹配" />
      </div>
      <el-button type="primary" @click="search" :loading="loading">查询SVN</el-button>
      <el-button @click="resetView">重置</el-button>
      <el-select v-model="selectedHistory" placeholder="历史记录" style="width: 200px" @change="loadHistory" clearable>
        <el-option v-for="(h, idx) in historyList" :key="idx" :label="h.label" :value="idx" />
      </el-select>
    </div>

    <!-- 文件列表对比 -->
    <div class="compare-panel">
      <div class="panel left">
        <div class="panel-header">目录A: {{ dirA }} ({{ filesA.length }}个文件)</div>
        <div class="file-list">
          <div
            v-for="file in filesA"
            :key="file.fullPath"
            class="file-item"
            :class="{ selected: selectedFile?.fullPath === file.fullPath, hasCommit: file.revision }"
            @click="selectFile(file, 'A')"
          >
            <span v-if="file.action" class="action" :class="file.action">{{ file.action }}</span>
            <span class="path">{{ file.path }}</span>
            <div v-if="file.revision" class="commit-info">
              <span>r{{ file.revision }}</span>
              <span>{{ file.author }}</span>
              <span>{{ file.message }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="panel right">
        <div class="panel-header">目录B: {{ dirB }} ({{ filesB.length }}个文件)</div>
        <div class="file-list">
          <div
            v-for="file in filesB"
            :key="file.fullPath"
            class="file-item"
            :class="{ selected: selectedFile?.fullPath === file.fullPath }"
            @click="selectFile(file, 'B')"
          >
            <span class="path">{{ file.path }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Diff弹窗 -->
    <el-dialog v-model="showDiff" title="文件差异对比" width="90%" top="5vh">
      <div class="diff-toolbar">
        <el-button @click="prevDiff">↑ 上一个差异</el-button>
        <el-button @click="nextDiff">↓ 下一个差异</el-button>
        <el-button type="warning" @click="syncCurrentDiff">← 同步当前差异</el-button>
        <el-button type="primary" @click="syncAllToRight">← 全部同步</el-button>
        <el-button type="success" @click="saveRightFile">保存</el-button>
        <span class="file-info">差异: {{ currentDiffIndex + 1 }}/{{ totalDiffs }}</span>
      </div>
      <div ref="diffContainer" class="diff-container"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import * as monaco from 'monaco-editor'

const dirA = ref('')
const dirB = ref('')
const days = ref(7)
const author = ref('')
const messageFilter = ref('')
const loading = ref(false)
const filesA = ref([])
const filesB = ref([])
const allFilesA = ref([])
const allFilesB = ref([])
const selectedFile = ref(null)
const showDiff = ref(false)
const diffContainer = ref(null)
const currentFileA = ref('')
const currentFileB = ref('')
const currentDiffIndex = ref(0)
const totalDiffs = ref(0)
let diffEditor = null
let currentFilePathB = ''
let lineChanges = []
const historyList = ref([])
const selectedHistory = ref(null)

async function selectDir(which) {
  const dir = await window.electronAPI.selectDirectory()
  if (dir) {
    if (which === 'A') {
      dirA.value = dir
      allFilesA.value = await window.electronAPI.listFiles(dir)
      filesA.value = []
    } else {
      dirB.value = dir
      allFilesB.value = await window.electronAPI.listFiles(dir)
      filesB.value = []
    }
  }
}

function resetView() {
  filesA.value = []
  filesB.value = []
}

async function search() {
  if (!dirA.value) {
    return alert('请选择目录A')
  }
  loading.value = true
  try {
    const logs = await window.electronAPI.getSvnLog({
      dirPath: dirA.value,
      days: days.value,
      author: author.value
    })

    // 从日志中提取文件（用完整路径作为key）
    const svnFiles = []
    for (const log of logs) {
      // 日志内容模糊过滤
      if (messageFilter.value && !log.message.toLowerCase().includes(messageFilter.value.toLowerCase())) {
        continue
      }
      for (const file of log.files) {
        svnFiles.push({
          ...file,
          svnPath: file.path,
          revision: log.revision,
          author: log.author,
          date: log.date,
          message: log.message
        })
      }
    }

    // 筛选左边文件 - 用路径后缀匹配
    const matchedA = []
    for (const localFile of allFilesA.value) {
      // 将本地路径转为正斜杠格式
      const localPath = localFile.path.replace(/\\/g, '/')
      // 查找SVN路径以本地路径结尾的记录
      const svnInfo = svnFiles.find(s => s.svnPath.endsWith('/' + localPath))
      if (svnInfo) {
        // 检查是否已存在，保留最新版本
        const existIdx = matchedA.findIndex(m => m.path === localFile.path)
        if (existIdx === -1) {
          matchedA.push({
            ...localFile,
            action: svnInfo.action,
            revision: svnInfo.revision,
            author: svnInfo.author,
            date: svnInfo.date,
            message: svnInfo.message
          })
        } else if (parseInt(svnInfo.revision) > parseInt(matchedA[existIdx].revision)) {
          matchedA[existIdx] = {
            ...localFile,
            action: svnInfo.action,
            revision: svnInfo.revision,
            author: svnInfo.author,
            date: svnInfo.date,
            message: svnInfo.message
          }
        }
      }
    }
    // 按提交时间倒序排序（最新的在前）
    matchedA.sort((a, b) => parseInt(b.revision) - parseInt(a.revision))
    filesA.value = matchedA

    // 筛选右边对应文件 - 用相对路径匹配
    const matchedPaths = new Set(matchedA.map(f => f.path))
    filesB.value = allFilesB.value.filter(f => matchedPaths.has(f.path))

  } catch (e) {
    alert('查询失败: ' + e.message)
  }
  loading.value = false

  // 保存到历史记录
  saveHistory()
}

function saveHistory() {
  // 提取目录名称
  const dirAName = dirA.value.split(/[/\\]/).pop() || dirA.value
  const dirBName = dirB.value.split(/[/\\]/).pop() || dirB.value
  const record = {
    label: `${dirAName} → ${dirBName} | ${days.value}天 | ${author.value || '全部作者'}`,
    dirA: dirA.value,
    dirB: dirB.value,
    days: days.value,
    author: author.value
  }
  // 避免重复
  const exists = historyList.value.find(h => h.dirA === record.dirA && h.dirB === record.dirB && h.days === record.days && h.author === record.author)
  if (!exists) {
    historyList.value.unshift(record)
    if (historyList.value.length > 10) historyList.value.pop()
    localStorage.setItem('svn-compare-history', JSON.stringify(historyList.value))
  }
}

async function loadHistory(idx) {
  if (idx === null || idx === undefined || idx === '') return
  const h = historyList.value[idx]
  if (!h) return
  dirA.value = h.dirA
  dirB.value = h.dirB
  days.value = h.days
  author.value = h.author
  // 先加载文件列表
  allFilesA.value = await window.electronAPI.listFiles(h.dirA)
  allFilesB.value = await window.electronAPI.listFiles(h.dirB)
  search()
}

// 初始化加载历史
try {
  const saved = localStorage.getItem('svn-compare-history')
  if (saved) historyList.value = JSON.parse(saved)
} catch (e) {}

async function selectFile(file, side) {
  selectedFile.value = file
  showDiff.value = true

  await nextTick()

  // 找到两边对应的文件 - 用相对路径匹配
  const relativePath = file.path
  const fileName = file.path.split('/').pop()
  const fileA = allFilesA.value.find(f => f.path === relativePath)
  const fileB = allFilesB.value.find(f => f.path === relativePath)

  currentFileA.value = fileA?.fullPath || '(不存在)'
  currentFileB.value = fileB?.fullPath || '(不存在)'
  currentFilePathB = fileB?.fullPath || ''

  const [contentA, contentB] = await Promise.all([
    fileA ? window.electronAPI.readFile(fileA.fullPath) : Promise.resolve(''),
    fileB ? window.electronAPI.readFile(fileB.fullPath) : Promise.resolve('')
  ])

  if (diffEditor) {
    diffEditor.dispose()
  }

  diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: true,
    glyphMargin: true
  })

  diffEditor.setModel({
    original: monaco.editor.createModel(contentA, getLanguage(fileName)),
    modified: monaco.editor.createModel(contentB, getLanguage(fileName))
  })

  // 获取差异信息
  setTimeout(() => {
    updateDiffInfo()
  }, 500)
}

function updateDiffInfo() {
  if (!diffEditor) return
  lineChanges = diffEditor.getLineChanges() || []
  totalDiffs.value = lineChanges.length
  currentDiffIndex.value = 0
}

function prevDiff() {
  if (!diffEditor || lineChanges.length === 0) return
  currentDiffIndex.value = Math.max(0, currentDiffIndex.value - 1)
  goToDiff(currentDiffIndex.value)
}

function nextDiff() {
  if (!diffEditor || lineChanges.length === 0) return
  currentDiffIndex.value = Math.min(lineChanges.length - 1, currentDiffIndex.value + 1)
  goToDiff(currentDiffIndex.value)
}

let currentDecorations = []

function goToDiff(index) {
  if (!lineChanges[index]) return
  const change = lineChanges[index]
  const origLine = change.originalStartLineNumber
  const modLine = change.modifiedStartLineNumber || 1

  // 滚动到差异位置
  diffEditor.getOriginalEditor().revealLineInCenter(origLine)
  diffEditor.getModifiedEditor().revealLineInCenter(modLine)

  // 添加箭头装饰
  highlightCurrentDiff(change)
}

function highlightCurrentDiff(change) {
  const origEditor = diffEditor.getOriginalEditor()
  const modEditor = diffEditor.getModifiedEditor()

  // 清除旧装饰
  currentDecorations = origEditor.deltaDecorations(currentDecorations, [])

  // 添加新装饰 - 左边箭头指示
  const origStart = change.originalStartLineNumber
  const origEnd = change.originalEndLineNumber || origStart

  currentDecorations = origEditor.deltaDecorations([], [{
    range: new monaco.Range(origStart, 1, origEnd, 1),
    options: {
      isWholeLine: true,
      className: 'current-diff-highlight',
      glyphMarginClassName: 'diff-arrow-glyph'
    }
  }])
}

function syncCurrentDiff() {
  if (!diffEditor || lineChanges.length === 0) return

  const change = lineChanges[currentDiffIndex.value]
  if (!change) return

  const originalModel = diffEditor.getModel().original
  const modifiedModel = diffEditor.getModel().modified

  const origStart = change.originalStartLineNumber
  const origEnd = change.originalEndLineNumber
  const modStart = change.modifiedStartLineNumber
  const modEnd = change.modifiedEndLineNumber

  // 获取原始行的完整内容（包括换行符）
  let originalLines = []
  for (let i = origStart; i <= origEnd; i++) {
    originalLines.push(originalModel.getLineContent(i))
  }
  let originalText = originalLines.join('\n')

  let range

  if (origEnd === 0) {
    // 左边没有内容（右边是新增的），需要删除右边
    range = new monaco.Range(modStart, 1, modEnd + 1, 1)
    originalText = ''
  } else if (modEnd === 0) {
    // 右边没有内容（右边删除了），需要插入左边内容
    range = new monaco.Range(modStart + 1, 1, modStart + 1, 1)
    originalText = originalText + '\n'
  } else {
    // 正常替换 - 替换整行
    range = new monaco.Range(modStart, 1, modEnd, modifiedModel.getLineMaxColumn(modEnd))
  }

  modifiedModel.pushEditOperations([], [{
    range: range,
    text: originalText
  }], () => null)

  // 更新差异信息
  setTimeout(updateDiffInfo, 300)
}

function syncAllToRight() {
  if (!diffEditor) return
  const originalContent = diffEditor.getModel().original.getValue()
  diffEditor.getModel().modified.setValue(originalContent)
  setTimeout(updateDiffInfo, 300)
}

async function saveRightFile() {
  if (!diffEditor || !currentFilePathB) {
    alert('没有可保存的文件')
    return
  }
  const content = diffEditor.getModel().modified.getValue()
  await window.electronAPI.writeFile(currentFilePathB, content)
  alert('保存成功')
}

function getLanguage(filePath) {
  const ext = filePath.split('.').pop().toLowerCase()
  const map = {
    js: 'javascript', ts: 'typescript', vue: 'html', html: 'html',
    css: 'css', json: 'json', py: 'python', java: 'java', c: 'c', cpp: 'cpp', xml: 'xml'
  }
  return map[ext] || 'plaintext'
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
.app { height: 100vh; display: flex; flex-direction: column; }
.filter-bar { padding: 15px; background: #f5f5f5; display: flex; gap: 15px; align-items: center; flex-wrap: wrap; }
.filter-item { display: flex; align-items: center; gap: 5px; }
.compare-panel { flex: 1; display: flex; overflow: hidden; }
.panel { flex: 1; display: flex; flex-direction: column; border: 1px solid #ddd; }
.panel-header { padding: 10px; background: #e0e0e0; font-weight: bold; }
.file-list { flex: 1; overflow-y: auto; }
.file-item { padding: 8px 12px; border-bottom: 1px solid #eee; cursor: pointer; }
.file-item:hover { background: #f0f7ff; }
.file-item.selected { background: #d0e8ff; }
.file-item.hasCommit { background: #fffde7; }
.action { display: inline-block; width: 20px; font-weight: bold; margin-right: 8px; }
.action.A { color: green; }
.action.M { color: orange; }
.action.D { color: red; }
.commit-info { font-size: 12px; color: #888; margin-top: 4px; display: flex; gap: 10px; }
.commit-info span:last-child { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-container { height: 70vh; }
.diff-toolbar { margin-bottom: 10px; display: flex; gap: 10px; align-items: center; }
.file-info { font-size: 12px; color: #666; margin-left: auto; }
.current-diff-highlight { background: rgba(255, 200, 0, 0.3) !important; }
.diff-arrow-glyph { background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="%23ff6600" d="M6 3v4H2v2h4v4l6-5-6-5z"/></svg>') center center no-repeat !important; }
</style>
