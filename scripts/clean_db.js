const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../src/database/db.js');
const destPath = path.join(__dirname, '../src/database/db_clean.js');

const code = fs.readFileSync(srcPath, 'utf8');

// State machine to parse code and strip comments, ignoring comments inside strings and regexes
function strip(code) {
  let result = '';
  let i = 0;
  let inString = false;
  let strChar = '';
  let inRegex = false;
  
  while (i < code.length) {
    let char = code[i];
    let next = code[i + 1] || '';
    
    if (inString) {
      result += char;
      if (char === strChar && code[i - 1] !== '\\') {
        inString = false;
      }
      i++;
      continue;
    }
    
    if (inRegex) {
      result += char;
      if (char === '/' && code[i - 1] !== '\\') {
        inRegex = false;
      }
      i++;
      continue;
    }
    
    // Check string start
    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      strChar = char;
      result += char;
      i++;
      continue;
    }
    
    // Check regex start (simplified: slash not preceded by word character or close parens/bracket)
    if (char === '/' && !/[a-zA-Z0-9_\)\]]/.test(code[i - 1] || '')) {
      // Check if it's a comment instead
      if (next === '/' || next === '*') {
        // Fall through to comment detection
      } else {
        inRegex = true;
        result += char;
        i++;
        continue;
      }
    }
    
    // Single line comment
    if (char === '/' && next === '/') {
      // Look ahead to check if this comment should be kept (i.e. is a function description)
      let commentContent = '';
      let j = i + 2;
      while (j < code.length && code[j] !== '\n' && code[j] !== '\r') {
        commentContent += code[j];
        j++;
      }
      
      // Let's inspect the next lines to see if it's followed by a function definition
      let nextLine = '';
      let k = j;
      while (k < code.length && nextLine.trim() === '') {
        let lineEnd = code.indexOf('\n', k);
        if (lineEnd === -1) {
          nextLine = code.substring(k);
          break;
        }
        nextLine = code.substring(k, lineEnd);
        k = lineEnd + 1;
      }
      
      const isHeader = nextLine.includes('function') || nextLine.includes('export');
      if (isHeader) {
        // Keep it as a simple function documentation
        result += '// ' + commentContent.trim();
      }
      
      i = j;
      continue;
    }
    
    // Block comment
    if (char === '/' && next === '*') {
      let j = i + 2;
      let isJSDoc = code[j] === '*';
      let commentContent = '';
      
      while (j < code.length && !(code[j] === '*' && code[j + 1] === '/')) {
        commentContent += code[j];
        j++;
      }
      
      let nextLine = '';
      let k = j + 2;
      while (k < code.length && nextLine.trim() === '') {
        let lineEnd = code.indexOf('\n', k);
        if (lineEnd === -1) {
          nextLine = code.substring(k);
          break;
        }
        nextLine = code.substring(k, lineEnd);
        k = lineEnd + 1;
      }
      
      const isHeader = nextLine.includes('function') || nextLine.includes('export');
      if (isHeader) {
        // Keep a simplified clean one-line documentation
        let cleanDoc = commentContent.replace(/\*+/g, '').replace(/\r/g, '').split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('@'))
          .join(' ');
        
        result += '// ' + cleanDoc.trim();
      }
      
      i = j + 2;
      continue;
    }
    
    result += char;
    i++;
  }
  return result;
}

const cleaned = strip(code);
fs.writeFileSync(destPath, cleaned, 'utf8');
console.log('Cleaned file generated successfully!');
