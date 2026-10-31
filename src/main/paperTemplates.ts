import type { PaperCreateRequest, PaperEngine } from '../shared/paper'

const escapeText = (value: string) => value.replace(/[\\{}%&#_$~^]/g, char => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '$': '\\$', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' })[char]!)

export function paperTemplate(request: PaperCreateRequest): { engine: PaperEngine; files: Record<string, string> } {
  const chinese = request.template === 'chinese'
  const title = escapeText(request.title || (chinese ? '我的第一篇论文' : 'A reproducible paper'))
  const author = escapeText(request.author || (chinese ? '作者' : 'Author'))
  return {
    engine: chinese ? 'xelatex' : 'pdflatex',
    files: {
      'main.tex': `${chinese ? '\\documentclass[UTF8,fontset=fandol,a4paper,11pt]{ctexart}' : `\\documentclass[a4paper,11pt${request.template === 'twocolumn' ? ',twocolumn' : ''}]{article}`}
\\usepackage[margin=25mm]{geometry}
\\usepackage{amsmath,graphicx,booktabs}
\\usepackage[hidelinks]{hyperref}
\\title{${title}}
\\author{${author}}
\\date{\\today}
\\begin{document}
\\maketitle
\\begin{abstract}
${chinese ? '这是一份可以直接编辑和编译的本地论文。正文、章节、公式、表格与参考文献都保留在普通 LaTeX 文件中。' : 'This project keeps the paper, sections, equations, tables and bibliography in ordinary local LaTeX files.'}
\\end{abstract}
\\input{sections/introduction}
\\section{${chinese ? '方法与结果' : 'Method and results'}}
\\label{sec:method}
${chinese ? '式~\\ref{eq:energy} 展示交叉引用；修改后重新编译，编号会自动更新。' : 'Equation~\\ref{eq:energy} demonstrates a cross-reference that updates on recompilation.'}
\\begin{equation}\\label{eq:energy}
E = mc^2
\\end{equation}
\\begin{table}[ht]
\\centering
\\caption{${chinese ? '示例测量数据' : 'Example measurements'}}
\\label{tab:results}
\\begin{tabular}{lrr}
\\toprule
${chinese ? '样本 & 数值 & 标准差' : 'Sample & Value & Deviation'} \\\\
\\midrule
A & 12.4 & 0.3 \\\\
B & 18.2 & 0.5 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\\newpage
\\section{${chinese ? '讨论' : 'Discussion'}}
${chinese ? '右侧显示实际编译的 PDF。两侧可以独立滚动；编译失败时，上一份有效 PDF 会继续保留。表~\\ref{tab:results} 来自前面的章节。' : 'The preview displays the compiled PDF. Both panes scroll independently. A failed build preserves the last successful PDF. Table~\\ref{tab:results} belongs to the preceding section.'}
\\bibliographystyle{plain}
\\bibliography{references}
\\end{document}
`,
      'sections/introduction.tex': `\\section{${chinese ? '引言' : 'Introduction'}}
${chinese ? '本模板将章节放在独立文件中。你可以切换文件修改，也可以在未保存时编译整个项目。参考文献示例见~\\cite{knuth1984}。' : 'Sections can live in separate files. Switch files to edit them, then compile a snapshot of all open buffers, including unsaved changes. See~\\cite{knuth1984} for a bibliography example.'}
`,
      'references.bib': '@book{knuth1984,\n  author = {Donald E. Knuth},\n  title = {The TeXbook},\n  publisher = {Addison-Wesley},\n  year = {1984}\n}\n',
    },
  }
}
