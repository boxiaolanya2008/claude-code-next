// 模拟 bun:bundle 模块的功能
// 用于开发环境，提供默认的特性标志

function feature(flag) {
  // 这里可以根据需要返回不同的特性标志值
  // 目前返回 false 作为默认值
  return false;
}

export { feature };
