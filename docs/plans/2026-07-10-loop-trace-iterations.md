# Loop Trace Iterations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 保留 Coze trace 接口中循环体或批处理节点的全部执行结果，而不是只显示第一次。

**Architecture:** 在现有节点合并层识别“相同节点 ID、不同 span ID”的 trace 节点，并复用已有 `iterations` 数据结构和报告页批次选择器。普通单次 trace 节点及节点历史补充记录继续按原逻辑合并。

**Tech Stack:** Chrome Extension Manifest V3、JavaScript、Node.js 内置测试框架。

### Task 1: 用测试重现数据丢失

**Files:**
- Modify: `tests/core.test.js`

**Step 1: Write the failing test**

构造 6 条节点 ID 相同、span ID 和输入输出不同的 `get_trace` span，断言整理后是一张节点卡且有 6 条 `iterations`。

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="keeps repeated trace spans" tests/core.test.js`

Expected: FAIL，因为当前节点没有 `iterations`。

### Task 2: 最小修复合并逻辑

**Files:**
- Modify: `core.js`
- Test: `tests/core.test.js`

**Step 1: Implement the minimal fix**

当目标和来源都是 trace 节点、节点 ID 相同且 span ID 不同时，把两条记录加入 `iterations`。用 span ID 作为没有显式批次编号时的唯一键，并保留原始顺序。

**Step 2: Run the focused test**

Run: `node --test --test-name-pattern="keeps repeated trace spans" tests/core.test.js`

Expected: PASS。

**Step 3: Run all tests**

Run: `npm test`

Expected: 全部 PASS。

### Task 3: 版本与本地测试包

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `v0.2.6/*`

**Step 1: Update version and notes**

将版本更新为 0.2.6，并用小白能看懂的描述说明修复内容。

**Step 2: Create a complete unpacked extension and zip**

复制运行所需文件到版本目录与本地输出目录，生成 zip，并检查 zip 中不包含测试或开发文件。

**Step 3: Verify package**

再次运行 `npm test`，检查 manifest、版本目录和 zip 文件清单。

**Step 4: Commit**

提交修复分支；未经用户再次确认，不推送或发布。
