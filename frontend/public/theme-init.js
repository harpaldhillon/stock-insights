// Applies the saved theme before React renders, to avoid a flash of the wrong
// theme. A separate file (not inline) so the Content-Security-Policy can
// forbid inline scripts.
try {
  var t = localStorage.getItem('theme')
  if (t === 'light') document.documentElement.classList.remove('dark')
  else document.documentElement.classList.add('dark')
} catch (e) { document.documentElement.classList.add('dark') }
