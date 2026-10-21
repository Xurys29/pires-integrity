"""Read the numbered, grid-based Execution Control PDF layout; never infer engineering data."""
import sys,json,re
import fitz
pdf=fitz.open(sys.argv[1])
if len(pdf)!=1: raise ValueError('Este leitor exige uma página; conferir outros layouts separadamente.')
p=pdf[0]
text=p.get_text(sort=True)
title=re.search(r'^\s*(.+?)\s*-\s*Execution Control\s*$',text,re.M|re.I)
if not title: raise ValueError('Cabeçalho Execution Control não encontrado.')
# Require the actual grid headings; a general PDF is not silently interpreted as this layout.
words=p.get_text('words')
headers={w[4]:w for w in words if 100<w[1]<130}
if not all(k in headers for k in ['Item','TAG','P&ID','Module','System','Comments']): raise ValueError('Layout não reconhecido; confira manualmente.')
company=re.search(r'^\s*(.+?)\s*-\s*([A-ZÀ-Ü][A-ZÀ-Ü ]+)\s*$',text,re.M)
if not company: raise ValueError('Empresa e local não identificados no cabeçalho.')
# This extractor is specific to the grid geometry, not a claim about other PDF formats.
edges=[37,49,97,155,194,225,263,309,338,360,377,402,471]
anchors=sorted([w for w in words if 37<w[0]<49 and w[1]>130 and re.fullmatch(r'\d{1,3}',w[4])],key=lambda w:w[1])
rows=[]
for item in anchors:
    cells=[]
    for left,right in zip(edges[1:],edges[2:]):
        tokens=sorted([w for w in words if abs(w[1]-item[1])<3 and left<=(w[0]+w[2])/2<right],key=lambda w:w[0])
        cells.append(' '.join(w[4] for w in tokens) or None)
    rows.append({'row':int(item[4]),'page':1,'bbox':[37,round(item[1]-4,3),471,round(item[3]+5,3)],'values':cells})
if not rows or [r['row'] for r in rows]!=list(range(1,len(rows)+1)): raise ValueError('Itens ausentes ou repetidos; conferir a página.')
columns=['TAG','P&ID','Module','System','Data inicial da inspeção','Data de término da inspeção','Visual Inspection','UTM','Isometric','Progress %','Comments']
date_values=[v for row in rows for v in row['values'][4:6] if v]
date_convention='DD/MM/YYYY nas colunas de inspeção, confirmado por dias maiores que 12 na mesma coluna' if any(re.fullmatch(r'\d{2}/\d{2}/\d{4}',v) and int(v[:2])>12 for v in date_values) else 'Pendente de confirmação; nenhuma data será normalizada automaticamente'
# Cross-check independent text extraction is done by the caller/tester before committing real data.
meta={'companyName':company.group(1).strip(),'location':company.group(2).strip(),'system':title.group(1).strip(),'documentReference':next((x.strip() for x in text.splitlines() if re.search(r'\bOS-\d+',x)),None),'dateConvention':date_convention,'headerText':text[:1200],'columns':columns,'extraction':'PyMuPDF por coordenadas da grade; fórmulas e aprovação não inferidas'}
json.dump({'format':'pdf_control','metadata':meta,'sheets':[{'name':'Página 1','rows':rows,'maxRow':len(rows),'maxColumn':len(columns)}]},sys.stdout,ensure_ascii=False)
