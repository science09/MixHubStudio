/**
 * WeChat HTML Adapters
 * Encapsulates adaptation helpers for styling and structure mapping when preparing HTML for WeChat.
 */

// Helper to determine if a color is light/dark
export const isColorLight = (colorStr) => {
  if (!colorStr) return false
  colorStr = colorStr.trim().toLowerCase()
  if (colorStr.includes('linear-gradient')) {
    const hexMatches = colorStr.match(/#[0-9a-fA-F]{3,8}\b/g)
    if (hexMatches) {
      for (const hex of hexMatches) {
        if (isColorLight(hex)) return true
      }
    }
    const rgbMatches = colorStr.match(/rgba?\(.*?\)/gi)
    if (rgbMatches) {
      for (const rgb of rgbMatches) {
        if (isColorLight(rgb)) return true
      }
    }
    return colorStr.includes('#fff') || colorStr.includes('255, 255, 255') || colorStr.includes('#f7f8fa') || colorStr.includes('#f2f3f5') || colorStr.includes('#fafafa') || colorStr.includes('#f6f8fa')
  }
  if (colorStr === 'transparent' || colorStr === 'rgba(0, 0, 0, 0)') {
    return true
  }
  if (colorStr.startsWith('#')) {
    let hex = colorStr.substring(1)
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return luma > 128
    }
  }
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1])
    const g = parseInt(rgbMatch[2])
    const b = parseInt(rgbMatch[3])
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luma > 128
  }
  const lightNamedColors = ['white', 'lightgray', 'lightgrey', 'whitesmoke', 'aliceblue', 'antiquewhite', 'azure', 'beige', 'bisque', 'blanchedalmond', 'cornsilk', 'floralwhite', 'gainsboro', 'ghostwhite', 'honeydew', 'ivory', 'lavender', 'lavenderblush', 'lemonchiffon', 'linen', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'oldlace', 'papayawhip', 'peachpuff', 'seashell', 'snow', 'thistle', 'wheat']
  if (lightNamedColors.includes(colorStr)) {
    return true
  }
  return false
}

// Helper to extract hex/rgb color
export const extractColor = (bgVal) => {
  if (!bgVal) return '#282c34'
  bgVal = bgVal.trim()
  const hexMatch = bgVal.match(/#[0-9a-fA-F]{3,8}\b/)
  if (hexMatch) return hexMatch[0]
  const rgbMatch = bgVal.match(/rgba?\(.*?\)/i)
  if (rgbMatch) return rgbMatch[0]
  const hslMatch = bgVal.match(/hsla?\(.*?\)/i)
  if (hslMatch) return hslMatch[0]
  if (/^[a-zA-Z]+$/.test(bgVal)) return bgVal
  return '#282c34'
}

// Helper to find coding block theme
export const getCodeThemeId = (themeCss) => {
  if (themeCss) {
    const match = themeCss.match(/#wenyan\s+pre\s*\{([^}]+)\}/)
    if (match) {
      const body = match[1]
      const bgMatch = body.match(/background(?:-color)?\s*:\s*([^;\n]+)/)
      if (bgMatch) {
        const bgVal = bgMatch[1].trim()
        if (isColorLight(bgVal)) {
          return 'github'
        }
      }
    }
  }
  return 'atom-one-dark'
}

// Helper to extract custom pre styles
export const extractPreStyles = (themeCss) => {
  const styles = {}
  if (!themeCss) return styles
  const match = themeCss.match(/#wenyan\s+pre\s*\{([^}]+)\}/)
  if (match) {
    const declarations = match[1].split(';')
    declarations.forEach(decl => {
      const index = decl.indexOf(':')
      if (index > 0) {
        const key = decl.substring(0, index).trim().toLowerCase()
        const val = decl.substring(index + 1).trim()
        if (key && val) {
          styles[key] = val
        }
      }
    })
  }
  return styles
}

// 1. Adapt Bullets/Lists
export const adaptWechatBullets = (element, themeCss) => {
  if (!element) return

  let bulletText = ''
  let bulletStyle = ''
  if (themeCss) {
    const liBeforeMatch = themeCss.replace(/\s+/g, ' ').match(/li::before\s*\{([^}]+)\}/)
    if (liBeforeMatch) {
      const decls = liBeforeMatch[1].split(';')
      const styles = []
      decls.forEach(decl => {
        const parts = decl.split(':')
        if (parts.length >= 2) {
          const key = parts[0].trim().toLowerCase()
          const val = parts.slice(1).join(':').trim()
          if (key === 'content') {
            bulletText = val.replace(/['"]/g, '')
          } else if (!['position', 'left', 'top', 'right', 'bottom', 'margin-left', 'margin-right', 'display', 'text-align', 'padding-right', 'width'].includes(key)) {
            styles.push(`${key}: ${val}`)
          }
        }
      })
      bulletStyle = styles.join('; ')
    }
  }

  // Remove whitespace text nodes directly inside ul and ol elements to prevent WeChat double bullets
  const lists = element.querySelectorAll('ul, ol')
  lists.forEach(list => {
    const childNodes = Array.from(list.childNodes)
    childNodes.forEach(node => {
      if (node.nodeType === 3) {
        node.parentNode.removeChild(node)
      }
    })
  })

  const listItems = element.querySelectorAll('li')
  const doc = element.ownerDocument || document
  listItems.forEach(li => {
    // Convert any nested <p> elements inside <li> to <span> to prevent WeChat block splitting
    const paragraphs = li.querySelectorAll('p')
    paragraphs.forEach(p => {
      const span = doc.createElement('span')
      for (let i = 0; i < p.attributes.length; i++) {
        const attr = p.attributes[i]
        span.setAttribute(attr.name, attr.value)
      }
      span.style.setProperty('display', 'inline', 'important')
      span.style.setProperty('margin', '0', 'important')
      span.style.setProperty('padding', '0', 'important')
      while (p.firstChild) {
        span.appendChild(p.firstChild)
      }
      p.parentNode.replaceChild(span, p)
    })

    // Clean direct whitespace text nodes inside li
    const childNodes = Array.from(li.childNodes)
    childNodes.forEach(node => {
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) {
          node.parentNode.removeChild(node)
        } else {
          node.textContent = node.textContent.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ')
        }
      }
    })

    const ul = li.closest('ul')
    const hasNoListStyle = (ul && (
      ul.style.listStyleType === 'none' || 
      ul.style.listStyle === 'none' || 
      (ul.getAttribute('style') || '').includes('list-style: none') || 
      (ul.getAttribute('style') || '').includes('list-style-type: none')
    )) || (
      li.style.listStyleType === 'none' || 
      li.style.listStyle === 'none' || 
      (li.getAttribute('style') || '').includes('list-style: none') || 
      (li.getAttribute('style') || '').includes('list-style-type: none')
    )

    const existingBullet = li.querySelector('.wechat-custom-bullet')
    const sec = li.querySelector(':scope > section')

    // If there is a section inside li, convert it to span to prevent block splitting
    if (sec) {
      const wrapper = doc.createElement('span')
      for (let i = 0; i < sec.attributes.length; i++) {
        const attr = sec.attributes[i]
        wrapper.setAttribute(attr.name, attr.value)
      }
      wrapper.style.setProperty('display', 'inline', 'important')
      wrapper.style.setProperty('margin', '0', 'important')
      wrapper.style.setProperty('padding', '0', 'important')
      while (sec.firstChild) {
        wrapper.appendChild(sec.firstChild)
      }
      li.replaceChild(wrapper, sec)
    }

    // If the list item contains any heading, style the li as a flex container and reduce heading margins
    const heading = li.querySelector('h1, h2, h3, h4, h5, h6')
    if (heading) {
      li.style.setProperty('display', 'flex', 'important')
      li.style.setProperty('align-items', 'center', 'important')
      li.style.setProperty('padding-left', '0', 'important')
      heading.style.setProperty('margin-top', '0.15em', 'important')
      heading.style.setProperty('margin-bottom', '0.15em', 'important')
    }

    // Insert custom bullet directly if needed
    if (hasNoListStyle && bulletText && !existingBullet) {
      const bulletSpan = doc.createElement('span')
      bulletSpan.className = 'wechat-custom-bullet'
      bulletSpan.setAttribute('style', bulletStyle)
      bulletSpan.style.setProperty('display', 'inline-block', 'important')
      bulletSpan.textContent = bulletText
      
      if (heading) {
        bulletSpan.style.setProperty('margin-left', '4px', 'important')
        bulletSpan.style.setProperty('margin-right', '8px', 'important')
        bulletSpan.style.setProperty('width', 'auto', 'important')
        bulletSpan.style.setProperty('padding-right', '0', 'important')
        bulletSpan.style.setProperty('flex-shrink', '0', 'important')
      } else {
        bulletSpan.style.setProperty('width', '1.2em', 'important')
        bulletSpan.style.setProperty('margin-left', '-1.2em', 'important')
        bulletSpan.style.setProperty('text-align', 'right', 'important')
        bulletSpan.style.setProperty('padding-right', '0.3em', 'important')
      }
      
      const target = li.querySelector(':scope > span') || li.firstChild
      if (target) {
        li.insertBefore(bulletSpan, target)
      } else {
        li.appendChild(bulletSpan)
      }
    } else if (existingBullet && heading) {
      existingBullet.style.setProperty('margin-left', '4px', 'important')
      existingBullet.style.setProperty('margin-right', '8px', 'important')
      existingBullet.style.setProperty('width', 'auto', 'important')
      existingBullet.style.setProperty('padding-right', '0', 'important')
      existingBullet.style.setProperty('flex-shrink', '0', 'important')
    }
  })
}

// 2. Adapt Footnotes
export const adaptWechatFootnotes = (element, themeCss) => {
  if (!element) return

  const footnotes = element.querySelector('#footnotes')
  if (!footnotes) return

  // Style the h3 directly preceding #footnotes
  const h3 = footnotes.previousElementSibling
  if (h3 && h3.tagName === 'H3') {
    h3.style.setProperty('margin-top', '2.5em', 'important')
    h3.style.setProperty('border-bottom', '1px solid #e1e4e8', 'important')
    h3.style.setProperty('padding-bottom', '8px', 'important')
    h3.style.setProperty('color', '#333', 'important')
    h3.style.setProperty('font-size', '16px', 'important')
    h3.style.setProperty('font-weight', 'bold', 'important')
    h3.style.setProperty('background', 'none', 'important')
    h3.style.setProperty('border-left', 'none', 'important')
    h3.style.setProperty('padding-left', '0', 'important')
    h3.style.setProperty('display', 'block', 'important')
  }

  // Style the footnotes container
  footnotes.style.setProperty('margin-top', '1.5em', 'important')

  // Extract primary theme color from themeCss or fallback
  let primaryColor = '#00b96b' // default green
  if (themeCss) {
    const match = themeCss.match(/--theme-primary:\s*([^;}\s]+)/)
    if (match) {
      primaryColor = match[1].trim()
    }
  }

  // Style individual paragraph/list items
  const items = footnotes.querySelectorAll('p, li')
  items.forEach(item => {
    item.style.setProperty('display', 'flex', 'important')
    item.style.setProperty('align-items', 'flex-start', 'important')
    item.style.setProperty('margin', '12px 0', 'important')
    item.style.setProperty('font-size', '13px', 'important')
    item.style.setProperty('line-height', '1.6', 'important')
    item.style.setProperty('color', '#555', 'important')

    const num = item.querySelector('.footnote-num')
    if (num) {
      num.style.setProperty('display', 'inline-block', 'important')
      num.style.setProperty('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', 'important')
      num.style.setProperty('font-weight', 'bold', 'important')
      num.style.setProperty('color', '#8c8c8c', 'important')
      num.style.setProperty('min-width', '24px', 'important')
      num.style.setProperty('margin-right', '12px', 'important')
      num.style.setProperty('flex-shrink', '0', 'important')
      num.style.setProperty('text-align', 'left', 'important')
    }

    const txt = item.querySelector('.footnote-txt')
    if (txt) {
      txt.style.setProperty('flex', '1', 'important')
      txt.style.setProperty('word-break', 'break-all', 'important')
      txt.style.setProperty('word-wrap', 'break-word', 'important')
      txt.style.setProperty('color', '#333', 'important')

      // Style all links and italics inside footnote-txt (the URLs/links)
      const links = txt.querySelectorAll('i, a')
      links.forEach(link => {
        link.style.setProperty('display', 'block', 'important')
        link.style.setProperty('font-style', 'normal', 'important')
        link.style.setProperty('color', primaryColor, 'important')
        link.style.setProperty('font-size', '12px', 'important')
        link.style.setProperty('margin-top', '4px', 'important')
        link.style.setProperty('word-break', 'break-all', 'important')
        link.style.setProperty('text-decoration', 'none', 'important')
      })
    }
  })
}

// 3. Adapt Tables
export const adaptWechatTables = (element) => {
  if (!element) return

  const tables = Array.from(element.querySelectorAll('table'))
  const doc = element.ownerDocument || document
  tables.forEach(table => {
    // Skip if it's our outer wrapper or a code block table
    if (table.classList.contains('wechat-table-outer-wrapper') || table.classList.contains('wechat-code-block-table')) {
      return
    }

    // Skip if it is already wrapped in our structure
    let parent = table.parentElement
    while (parent && parent !== element) {
      if (parent.classList.contains('wechat-table-outer-wrapper') || parent.classList.contains('wechat-code-block-table')) {
        return
      }
      parent = parent.parentElement
    }

    // Set style of table to not squish cells
    table.style.setProperty('width', 'auto', 'important')
    table.style.setProperty('min-width', '100%', 'important')
    table.style.setProperty('table-layout', 'auto', 'important')
    table.style.setProperty('border-collapse', 'collapse', 'important')
    table.style.setProperty('margin', '0', 'important')

    // Style table headers to stay on a single line
    const ths = table.querySelectorAll('th')
    ths.forEach(th => {
      th.style.setProperty('white-space', 'nowrap', 'important')
      th.style.setProperty('word-break', 'keep-all', 'important')
      if (!th.querySelector('.wechat-table-cell-nowrap')) {
        const span = doc.createElement('span')
        span.className = 'wechat-table-cell-nowrap'
        span.setAttribute('style', 'white-space: nowrap !important; display: inline-block !important;')
        while (th.firstChild) {
          span.appendChild(th.firstChild)
        }
        th.appendChild(span)
      }
    })
    
    // Style table cells with numbers/short content to stay on a single line
    const tds = table.querySelectorAll('td')
    tds.forEach(td => {
      const text = td.textContent.trim()
      if (text.length < 15 || /^[0-9.\-\s]+$/.test(text)) {
        td.style.setProperty('white-space', 'nowrap', 'important')
        td.style.setProperty('word-break', 'keep-all', 'important')
        if (!td.querySelector('.wechat-table-cell-nowrap')) {
          const span = doc.createElement('span')
          span.className = 'wechat-table-cell-nowrap'
          span.setAttribute('style', 'white-space: nowrap !important; display: inline-block !important;')
          while (td.firstChild) {
            span.appendChild(td.firstChild)
          }
          td.appendChild(span)
        }
      }
    })

    // Create the outer wrapper table to prevent WeChat editor from inserting blank lines
    const outerTable = doc.createElement('table')
    outerTable.className = 'wechat-table-outer-wrapper'
    outerTable.setAttribute('style', 'width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; display: table !important; margin: 0.2em 0 !important; border: none !important; box-sizing: border-box !important; background: transparent !important; box-shadow: none !important; border-radius: 0 !important;')
    
    const tbody = doc.createElement('tbody')
    const tr = doc.createElement('tr')
    tr.setAttribute('style', 'border: none !important; background: transparent !important; box-shadow: none !important;')
    
    const td = doc.createElement('td')
    td.setAttribute('style', 'width: 100% !important; padding: 0 !important; margin: 0 !important; border: none !important; box-sizing: border-box !important; background: transparent !important; box-shadow: none !important;')
    
    // Create the scroll wrapper section inside td
    const scrollWrapper = doc.createElement('section')
    scrollWrapper.className = 'wechat-table-scroll-wrapper'
    scrollWrapper.setAttribute('style', 'overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; width: 100% !important; display: block !important; margin: 0 !important; padding: 0 !important;')
    
    // Build the hierarchy: outerTable -> tbody -> tr -> td -> scrollWrapper -> table
    tr.appendChild(td)
    tbody.appendChild(tr)
    outerTable.appendChild(tbody)
    
    table.parentNode.insertBefore(outerTable, table)
    scrollWrapper.appendChild(table)
    td.appendChild(scrollWrapper)
  })
}

// 4. Adapt Code Blocks
export const adaptWechatCodeBlocks = (element, themeCss) => {
  if (!element) return

  const customPreStyles = extractPreStyles(themeCss)
  const customBg = customPreStyles['background'] || customPreStyles['background-color']
  const doc = element.ownerDocument || document

  // Convert pre elements to table structures to prevent WeChat editor from adding extra paragraphs and wrapping lines
  const pres = Array.from(element.querySelectorAll('pre'))
  pres.forEach(pre => {
    // 1. Create the table structure to act as the outer container
    const table = doc.createElement('table')
    table.className = 'wechat-code-block-table'
    const tbody = doc.createElement('tbody')
    const tr = doc.createElement('tr')
    const td = doc.createElement('td')
    td.className = 'wechat-code-block-td'
    
    tr.appendChild(td)
    tbody.appendChild(tr)
    table.appendChild(tbody)
    
    // Copy the original pre styling (background, border-radius, colors)
    const origStyle = pre.getAttribute('style') || ''
    table.setAttribute('style', origStyle)
    
    // Extract background color dynamically from origStyle to determine if it is a light theme
    let rawBgVal = ''
    let rawBgColorVal = ''
    const bgMatches = origStyle.matchAll(/(?:^|;)\s*(background(?:-color)?)\s*:\s*([^;]+)/gi)
    for (const match of bgMatches) {
      const prop = match[1].toLowerCase()
      let val = match[2].trim().replace(/\s*!important\s*$/i, '')
      if (prop === 'background-color') {
        rawBgColorVal = val
      } else if (prop === 'background') {
        rawBgVal = val
      }
    }
    
    const finalBgVal = customBg || rawBgColorVal || rawBgVal || '#282c34'
    const cleanBgColor = extractColor(finalBgVal)
    const isLight = isColorLight(cleanBgColor)
    const colorScheme = isLight ? 'light' : 'dark'
    
    // Extract text color dynamically
    const textColorMatch = origStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)
    let textColor = textColorMatch ? textColorMatch[1].trim().replace(/\s*!important\s*$/i, '') : ''
    if (!textColor) {
      textColor = isLight ? '#24292e' : '#abb2bf'
    }

    // Set table layout overrides (no margins, width 100%, collapse borders)
    table.style.setProperty('width', '100%', 'important')
    table.style.setProperty('border-collapse', 'collapse', 'important')
    table.style.setProperty('display', 'table', 'important')
    if (customPreStyles['margin']) {
      table.style.setProperty('margin', customPreStyles['margin'], 'important')
    } else {
      table.style.setProperty('margin', '1.2em 0', 'important')
    }
    table.style.setProperty('box-sizing', 'border-box', 'important')
    table.style.setProperty('table-layout', 'fixed', 'important')
    table.style.setProperty('overflow', 'hidden', 'important')
    table.style.setProperty('overflow-x', 'hidden', 'important')
    table.style.setProperty('color-scheme', colorScheme, 'important')
    if (textColor) {
      table.style.setProperty('color', textColor, 'important')
    }
    if (customBg) {
      table.style.setProperty('background', customBg, 'important')
    }
    
    // Apply custom borders if defined in themeCss, otherwise default to none
    const borderProps = ['border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-color', 'border-style', 'border-width']
    let hasCustomBorder = false
    borderProps.forEach(prop => {
      if (customPreStyles[prop]) {
        table.style.setProperty(prop, customPreStyles[prop], 'important')
        hasCustomBorder = true
      }
    })
    if (!hasCustomBorder) {
      table.style.setProperty('border', 'none', 'important')
    }

    if (customPreStyles['box-shadow']) {
      table.style.setProperty('box-shadow', customPreStyles['box-shadow'], 'important')
    }

    // Set td styling to match the background and text colors of pre, and have proper padding
    td.setAttribute('style', origStyle)
    if (customBg) {
      td.style.setProperty('background', 'transparent', 'important')
    }
    if (customPreStyles['padding']) {
      td.style.setProperty('padding', customPreStyles['padding'], 'important')
    } else {
      td.style.setProperty('padding', '1.25em 1.5em', 'important')
    }
    td.style.setProperty('margin', '0', 'important')
    td.style.setProperty('border', 'none', 'important')
    td.style.setProperty('box-sizing', 'border-box', 'important')
    td.style.setProperty('word-break', 'normal', 'important')
    td.style.setProperty('word-wrap', 'normal', 'important')
    td.style.setProperty('overflow-wrap', 'normal', 'important')
    td.style.setProperty('white-space', 'normal', 'important')
    td.style.setProperty('overflow', 'hidden', 'important')
    td.style.setProperty('overflow-x', 'hidden', 'important')
    td.style.setProperty('color-scheme', colorScheme, 'important')
    if (textColor) {
      td.style.setProperty('color', textColor, 'important')
    }

    const radiusProps = ['border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']
    let hasCustomRadius = false
    radiusProps.forEach(prop => {
      if (customPreStyles[prop]) {
        table.style.setProperty(prop, customPreStyles[prop], 'important')
        td.style.setProperty(prop, customPreStyles[prop], 'important')
        hasCustomRadius = true
      }
    })
    if (!hasCustomRadius) {
      const preRadius = pre.style.borderRadius
      if (preRadius) {
        table.style.setProperty('border-radius', preRadius, 'important')
        td.style.setProperty('border-radius', preRadius, 'important')
      } else {
        table.style.setProperty('border-radius', '8px', 'important')
        td.style.setProperty('border-radius', '8px', 'important')
      }
    }
    
    // Handle dots header
    const firstChild = pre.firstElementChild
    const newHeader = doc.createElement('section')
    newHeader.style.setProperty('display', 'block', 'important')
    newHeader.style.setProperty('margin', '0 0 12px 0', 'important')
    newHeader.style.setProperty('padding', '0', 'important')
    newHeader.style.setProperty('height', '9px', 'important')
    newHeader.style.setProperty('line-height', '0', 'important')
    newHeader.style.setProperty('font-size', '0', 'important')
    
    const dotColors = ['rgb(237, 108, 96)', 'rgb(247, 193, 81)', 'rgb(100, 200, 86)']
    dotColors.forEach(color => {
      const dot = doc.createElement('span')
      dot.setAttribute('style', 'width: 9px; height: 9px; border-radius: 50%; background-color: ' + color + '; display: inline-block; margin-right: 6px; font-size: 0px; line-height: 0px;')
      dot.innerHTML = '&nbsp;'
      newHeader.appendChild(dot)
    })
    td.appendChild(newHeader)
    
    // Process code element and convert to nowrap sections line-by-line
    const code = pre.querySelector('code')
    const codeContainer = doc.createElement('section')
    codeContainer.style.setProperty('display', 'block', 'important')
    codeContainer.style.setProperty('overflow-x', 'auto', 'important')
    codeContainer.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important')
    codeContainer.style.setProperty('width', '100%', 'important')
    codeContainer.style.setProperty('max-width', '100%', 'important')
    codeContainer.style.setProperty('box-sizing', 'border-box', 'important')
    codeContainer.style.setProperty('margin', '0', 'important')
    codeContainer.style.setProperty('padding', '0', 'important')
    codeContainer.style.setProperty('color-scheme', colorScheme, 'important')
    codeContainer.style.setProperty('font-family', "'SFMono-Regular', Consolas, Menlo, monospace", 'important')
    codeContainer.style.setProperty('font-size', '14px', 'important')
    codeContainer.style.setProperty('line-height', '1.6', 'important')
    codeContainer.style.setProperty('word-wrap', 'normal', 'important')
    codeContainer.style.setProperty('word-break', 'normal', 'important')
    codeContainer.style.setProperty('overflow-wrap', 'normal', 'important')
    codeContainer.style.setProperty('color', textColor || 'inherit', 'important')
    
    // Apply background styles to codeContainer for scrollbar track wrapping
    for (const match of origStyle.matchAll(/(?:^|;)\s*(background(?:-color)?)\s*:\s*([^;]+)/gi)) {
      const prop = match[1].toLowerCase()
      let val = match[2].trim().replace(/\s*!important\s*$/i, '')
      codeContainer.style.setProperty(prop, val, 'important')
    }

    if (customBg) {
      codeContainer.style.setProperty('background', 'transparent', 'important')
      codeContainer.style.setProperty('background-color', 'transparent', 'important')
    }

    // Set scrollbar styles inline
    const thumbColor = isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.25)'
    codeContainer.style.setProperty('scrollbar-color', thumbColor + ' ' + cleanBgColor, 'important')
    codeContainer.style.setProperty('scrollbar-width', 'thin', 'important')
    
    const codeLinesWrapper = doc.createElement('section')
    codeLinesWrapper.style.setProperty('display', 'block', 'important')
    codeLinesWrapper.style.setProperty('width', '100%', 'important')
    codeLinesWrapper.style.setProperty('box-sizing', 'border-box', 'important')
    codeLinesWrapper.style.setProperty('margin', '0', 'important')
    codeLinesWrapper.style.setProperty('padding', '0', 'important')
    
    if (code) {
      const lines = [[]]
      Array.from(code.childNodes).forEach(node => {
        if (node.tagName === 'BR') {
          lines.push([])
        } else {
          lines[lines.length - 1].push(node.cloneNode(true))
        }
      })
      
      if (lines.length > 1 && lines[lines.length - 1].length === 0) {
        lines.pop()
      }
      
      lines.forEach(lineNodes => {
        const lineSection = doc.createElement('section')
        lineSection.style.setProperty('display', 'block', 'important')
        lineSection.style.setProperty('white-space', 'nowrap', 'important')
        lineSection.style.setProperty('margin', '0', 'important')
        lineSection.style.setProperty('padding', '0', 'important')
        if (textColor) {
          lineSection.style.setProperty('color', textColor, 'important')
        }
        
        if (lineNodes.length === 0) {
          lineSection.innerHTML = '&nbsp;'
        } else {
          lineNodes.forEach(node => {
            lineSection.appendChild(node)
          })
        }
        codeLinesWrapper.appendChild(lineSection)
      })
    } else {
      const lines = [[]]
      const nodesToProcess = Array.from(pre.childNodes).filter(child => child !== firstChild)
      nodesToProcess.forEach(node => {
        if (node.tagName === 'BR') {
          lines.push([])
        } else {
          lines[lines.length - 1].push(node.cloneNode(true))
        }
      })
      
      if (lines.length > 1 && lines[lines.length - 1].length === 0) {
        lines.pop()
      }
      
      lines.forEach(lineNodes => {
        const lineSection = doc.createElement('section')
        lineSection.style.setProperty('display', 'block', 'important')
        lineSection.style.setProperty('white-space', 'nowrap', 'important')
        lineSection.style.setProperty('margin', '0', 'important')
        lineSection.style.setProperty('padding', '0', 'important')
        if (textColor) {
          lineSection.style.setProperty('color', textColor, 'important')
        }
        
        if (lineNodes.length === 0) {
          lineSection.innerHTML = '&nbsp;'
        } else {
          lineNodes.forEach(node => {
            lineSection.appendChild(node)
          })
        }
        codeLinesWrapper.appendChild(lineSection)
      })
    }
    
    codeContainer.appendChild(codeLinesWrapper)
    td.appendChild(codeContainer)
    
    // Replace the original pre element in the DOM
    pre.parentNode.replaceChild(table, pre)
  })

  // Convert remaining inline code elements to span elements to prevent WeChat from forcing display: block or splitting blocks
  const inlineCodes = Array.from(element.querySelectorAll('code'))
  inlineCodes.forEach(code => {
    const span = doc.createElement('span')
    span.className = 'wechat-inline-code'
    
    // Copy attributes
    for (let i = 0; i < code.attributes.length; i++) {
      const attr = code.attributes[i]
      span.setAttribute(attr.name, attr.value)
    }
    
    // Copy style properties
    const origStyle = code.getAttribute('style') || ''
    span.setAttribute('style', origStyle)
    span.style.setProperty('display', 'inline', 'important')
    span.style.setProperty('white-space', 'normal', 'important')
    span.style.setProperty('font-family', "'SFMono-Regular', Consolas, Menlo, monospace", 'important')
    
    // Move children
    while (code.firstChild) {
      span.appendChild(code.firstChild)
    }
    
    code.parentNode.replaceChild(span, code)
  })

  // Strip any remaining SVGs in the rest of the document
  const remainingSvgs = element.querySelectorAll('svg')
  remainingSvgs.forEach(svg => svg.remove())
}

// 5. Propagate WeChat styles inherited properties
export const propagateWechatStyles = (element) => {
  if (!element) return

  const root = element.querySelector('#wenyan') || element
  const rootStyle = root.getAttribute('style') || ''
  
  // Extract inherited properties from the root element
  const inheritedProps = ['font-family', 'color', 'font-size', 'line-height', 'letter-spacing']
  const inheritedStyles = {}
  
  inheritedProps.forEach(prop => {
    const match = rootStyle.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'))
    if (match) {
      inheritedStyles[prop] = match[1].trim()
    }
  })
  
  // Propagate to all text/block children
  const children = root.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, span, th, td')
  children.forEach(child => {
    // Skip code elements and elements inside pre/code blocks
    if (child.tagName === 'CODE' || child.closest('pre') || child.closest('.wechat-code-block-table')) return
    
    // Skip custom bullets or footnotes if they have their own defined colors/styles
    if (child.classList.contains('wechat-custom-bullet') || child.classList.contains('footnote-link')) return

    const childStyle = child.getAttribute('style') || ''
    inheritedProps.forEach(prop => {
      // If the child doesn't have this style property explicitly set
      if (inheritedStyles[prop] && !childStyle.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:`, 'i'))) {
        child.style.setProperty(prop, inheritedStyles[prop])
      }
    })
  })
}

// 6. Adapt WeChat Links
export const adaptWechatLinks = (element) => {
  if (!element) return

  const links = Array.from(element.querySelectorAll('a'))
  const doc = element.ownerDocument || document
  links.forEach(link => {
    const href = link.getAttribute('href')
    const isWechatDomain = href && href.includes('mp.weixin.qq.com')
    
    if (!isWechatDomain) {
      // Create a span to replace the anchor link
      const span = doc.createElement('span')
      
      // Copy all attributes (except href)
      for (let i = 0; i < link.attributes.length; i++) {
        const attr = link.attributes[i]
        if (attr.name !== 'href') {
          span.setAttribute(attr.name, attr.value)
        }
      }
      
      // Copy inline styles
      const origStyle = link.getAttribute('style') || ''
      span.setAttribute('style', origStyle)
      span.style.setProperty('cursor', 'default', 'important')
      
      // Move all children
      while (link.firstChild) {
        span.appendChild(link.firstChild)
      }
      
      link.parentNode.replaceChild(span, link)
    }
  })
}

// 7. Adapt Blockquotes
export const adaptWechatBlockquotes = (element) => {
  if (!element) return
  const blockquotes = element.querySelectorAll('blockquote')
  blockquotes.forEach(bq => {
    const quoteMark = bq.querySelector(':scope > section')
    const firstP = bq.querySelector('p')
    if (quoteMark && firstP) {
      firstP.insertBefore(quoteMark, firstP.firstChild)
    }
  })
}

// 8. Clean WeChat HTML
export const cleanWechatHtml = (html) => {
  if (!html) return ''
  
  // Remove HTML comments
  let cleaned = html.replace(/<!--[\s\S]*?-->/g, '')
  
  // Remove Vue scope attributes if they leak into HTML copies (e.g. data-v-xxxxx)
  cleaned = cleaned.replace(/\s+data-v-[0-9a-zA-Z]+(=["'][^"']*["'])?/g, '')
  
  // Remove empty inline tags or spacing attributes to reduce markup size
  cleaned = cleaned.replace(/\s+(?:id|style)=["']\s*["']/gi, '')
  
  // Since style properties are already fully inlined, the CSS class names 
  // are redundant in WeChat and can be completely removed to shrink the payload.
  cleaned = cleaned.replace(/\s+class=["'][^"']*["']/gi, '')

  // Strip whitespace and newlines between block-level tags
  // to prevent WeChat editor from inserting extra empty paragraphs <p><br></p>
  const blockTags = 'p|h[1-6]|blockquote|ul|ol|li|pre|table|tbody|thead|tfoot|tr|th|td|section|figure|figcaption|div|hr'
  const regex = new RegExp(`(</?(?:${blockTags})[^>]*>)\\s+(?=<)`, 'g')
  return cleaned.replace(regex, '$1')
}
