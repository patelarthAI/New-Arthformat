import { ResumeData, ResumeFormat } from "@/types";
import { cleanBullet, groupBulletPoints, processDescription } from "@/utils/formatters";

// Helper to format title with colon
const formatTitle = (title: string) => {
  const trimmed = title.trim();
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
};

// Helper to expand months for Modern format
const formatModernDate = (dateStr: string) => {
    if (!dateStr) return "";
    
    const monthMap: { [key: string]: string } = {
        "Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April",
        "May": "May", "Jun": "June", "Jul": "July", "Aug": "August",
        "Sep": "September", "Oct": "October", "Nov": "November", "Dec": "December",
        "Sept": "September"
    };

    let formatted = dateStr;
    Object.keys(monthMap).forEach(short => {
        const regex = new RegExp(`\\b${short}\\b`, 'g');
        formatted = formatted.replace(regex, monthMap[short]);
    });
    
    return formatted;
};

export const generateResumePDF = async (data: ResumeData, format: ResumeFormat | string = ResumeFormat.CLASSIC_PROFESSIONAL) => {
  console.log("generateResumePDF called with format:", format);
  
  // Dynamically import pdfmake to reduce initial bundle size
  const pdfMakeModule = await import("pdfmake/build/pdfmake");
  const pdfFontsModule = await import("pdfmake/build/vfs_fonts");
  
  const pm = (pdfMakeModule as any).default || pdfMakeModule;
  const pf = (pdfFontsModule as any).default || pdfFontsModule;
  
  if (pm && pf) {
    if (pf.pdfMake && pf.pdfMake.vfs) {
      pm.vfs = pf.pdfMake.vfs;
    } else if (pf.vfs) {
      pm.vfs = pf.vfs;
    }
  }
  
  const content: any[] = [];
  
  // Define styles based on format
  // Ensure we compare against the string value to avoid any enum object issues
  const isModern = format === 'MODERN_EXECUTIVE' || format === ResumeFormat.MODERN_EXECUTIVE;
  
  console.log("isModern calculated as:", isModern);
  
  const styles = {
      nameFontSize: isModern ? 12 : 18,
      bodyFontSize: isModern ? 11 : 11,
      nameAlignment: isModern ? 'left' : 'center',
      headerMargin: isModern ? [0, 0, 0, 15] : [0, 0, 0, 10],
      sectionHeaderDecoration: undefined,
      jobLayout: isModern ? 'modern' : 'classic'
  };

  // 1. Name
  content.push({
    text: data.fullName.toUpperCase(),
    style: 'nameHeader',
    alignment: styles.nameAlignment,
    margin: [0, 0, 0, 2]
  });

  // 2. Contact Info
  if (isModern && data.contactInfo?.location) {
      content.push({
          text: data.contactInfo.location,
          fontSize: isModern ? 12 : 11,
          bold: isModern,
          alignment: styles.nameAlignment,
          margin: isModern ? [0, 0, 0, 15] : [0, 0, 0, 10]
      });
  }

  // 3. Summary
  if (data.summary) {
    content.push({
      text: formatTitle(data.sectionTitleSummary || "SUMMARY").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 12, 0, 12] : [0, 10, 0, 5],
      decoration: isModern ? undefined : undefined // Classic preview has border-bottom, pdfmake is harder, keeping clean
    });

    const summaryItems = Array.isArray(data.summary) ? data.summary : [data.summary as unknown as string];
    const processedSummary = processDescription(summaryItems);

    if (processedSummary.length === 1) {
      content.push({
        text: cleanBullet(processedSummary[0]),
        style: 'bodyText',
        margin: [0, 0, 0, 5]
      });
    } else {
      content.push({
        ul: processedSummary.map(s => ({ text: cleanBullet(s), fontSize: styles.bodyFontSize })), 
        fontSize: 13, // Set bullet size
        style: 'bodyText',
        margin: isModern ? [25, 0, 0, 5] : [0, 0, 0, 5]
      });
    }
  }

  // 4. Experience
  if (data.experience && data.experience.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 12, 0, 12] : [0, 10, 0, 5]
    });

    data.experience.forEach(exp => {
      if (isModern) {
          // Modern Layout: 
          // Date Range
          // Company, Location
          // Title (Italic)
          if (exp.dates && exp.dates !== "undefined") {
            content.push({
                text: formatModernDate(exp.dates),
                style: 'bodyText',
                bold: true,
                margin: [0, 0, 0, 2]
            });
          }
          content.push({
              text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: exp.title,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          // Classic Layout: Company | Date -> Title
          const columns: any[] = [
            {
              text: [
                { text: exp.company, bold: true },
                exp.location ? `, ${exp.location}` : ''
              ],
              style: 'bodyText',
              width: '*'
            }
          ];
          
          if (exp.dates && exp.dates !== "undefined") {
            columns.push({
              text: exp.dates,
              style: 'bodyText',
              bold: true,
              alignment: 'right',
              width: 'auto'
            });
          }

          content.push({
            columns: columns,
            margin: [0, 0, 0, 2]
          });

          content.push({
            text: exp.title,
            style: 'bodyText',
            bold: true,
            margin: [0, 0, 0, 2]
          });
      }

      // Bullets
      if (exp.description && exp.description.length > 0) {
        content.push({
          ul: processDescription([...exp.description]).map(s => ({ text: s, fontSize: styles.bodyFontSize })), 
          fontSize: 13,
          style: 'bodyText',
          margin: isModern ? [25, 0, 0, 8] : [0, 0, 0, 8]
        });
      }
    });
  }

  // 5. Internships
  if (data.internships && data.internships.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleInternships || "INTERNSHIPS").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 12, 0, 12] : [0, 10, 0, 5]
    });

    data.internships.forEach(exp => {
      if (isModern) {
          if (exp.dates && exp.dates !== "undefined") {
            content.push({
                text: formatModernDate(exp.dates),
                style: 'bodyText',
                bold: true,
                margin: [0, 0, 0, 2]
            });
          }
          content.push({
              text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: exp.title,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          const columns: any[] = [
            {
              text: [
                { text: exp.company, bold: true },
                exp.location ? `, ${exp.location}` : ''
              ],
              style: 'bodyText',
              width: '*'
            }
          ];
          
          if (exp.dates && exp.dates !== "undefined") {
            columns.push({
              text: exp.dates,
              style: 'bodyText',
              bold: true,
              alignment: 'right',
              width: 'auto'
            });
          }

          content.push({
            columns: columns,
            margin: [0, 0, 0, 2]
          });

          content.push({
            text: exp.title,
            style: 'bodyText',
            bold: true,
            margin: [0, 0, 0, 2]
          });
      }

      if (exp.description && exp.description.length > 0) {
        content.push({
          ul: processDescription([...exp.description]).map(s => ({ text: s, fontSize: styles.bodyFontSize })), 
          fontSize: 13,
          style: 'bodyText',
          margin: isModern ? [25, 0, 0, 8] : [0, 0, 0, 8]
        });
      }
    });
  }

  // 6. Education
  if (data.education && data.education.length > 0) {
    content.push({
      text: formatTitle(data.sectionTitleEducation || "EDUCATION").toUpperCase(),
      style: 'sectionHeader',
      margin: isModern ? [0, 12, 0, 12] : [0, 10, 0, 5]
    });

    data.education.forEach(edu => {
      const columns: any[] = [
        {
          text: [
            { text: edu.institution, bold: true },
            edu.location ? `, ${edu.location}` : ''
          ],
          style: 'bodyText',
          width: '*'
        }
      ];
      
      if (edu.dates && edu.dates !== "undefined") {
        columns.push({
          text: isModern ? formatModernDate(edu.dates) : edu.dates,
          style: 'bodyText',
          bold: true,
          alignment: 'right',
          width: 'auto'
        });
      }

      content.push({
        columns: columns,
        margin: [0, 0, 0, 2]
      });

      content.push({
        text: edu.degree,
        style: 'bodyText',
        bold: true,
        margin: [0, 0, 0, 2]
      });

      if (edu.details && edu.details.length > 0) {
        content.push({
          ul: processDescription([...edu.details]).map(s => ({ text: s, fontSize: styles.bodyFontSize })), 
          fontSize: 13,
          style: 'bodyText',
          margin: isModern ? [25, 0, 0, 8] : [0, 0, 0, 8]
        });
      }
    });
  }

  // 7. Custom Sections
  if (data.customSections) {
    data.customSections.forEach(section => {
      content.push({
        text: formatTitle(section.title).toUpperCase(),
        style: 'sectionHeader',
        margin: isModern ? [0, 12, 0, 12] : [0, 10, 0, 5]
      });

      const titleUpper = section.title.toUpperCase();
      const isGridCandidate = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
      const hasLongItems = section.items && section.items.some(item => item.length > 60);
      const useColumns = isGridCandidate && !hasLongItems && section.items && section.items.length > 2;

      if (useColumns && section.items) {
        const groupedItems = groupBulletPoints(section.items);
        const maxLen = Math.max(...section.items.map(i => i.length));
        const numCols = maxLen < 35 ? 3 : 2;
        const cols: any[][] = Array.from({ length: numCols }, () => []);
        
        const rows = Math.ceil(groupedItems.length / numCols);
        groupedItems.forEach((g, idx) => {
          const colIdx = Math.floor(idx / rows);
          if (cols[colIdx]) {
            if (g.key) {
              if (g.values.length === 1) {
                cols[colIdx].push({
                  text: [
                    { text: g.key + ": ", bold: true },
                    g.values[0].text
                  ],
                  listType: 'none',
                  margin: [0, 2, 0, 2]
                });
              } else {
                cols[colIdx].push({
                  text: g.key + ":",
                  bold: true,
                  listType: 'none',
                  margin: [0, 2, 0, 2]
                });
                cols[colIdx].push({
                  ul: g.values.map(v => ({ text: v.text, fontSize: styles.bodyFontSize })),
                  fontSize: 13,
                  margin: isModern ? [25, 0, 0, 2] : [0, 0, 0, 2]
                });
              }
            } else {
              cols[colIdx].push({
                ul: g.values.map(v => ({ text: v.text, fontSize: styles.bodyFontSize })),
                fontSize: 13,
                margin: isModern ? [25, 2, 0, 2] : [0, 2, 0, 2]
              });
            }
          }
        });

        content.push({
          columns: cols.map(col => ({ stack: col, style: 'bodyText' })),
          margin: [0, 0, 0, 5]
        });
      } else if (section.items) {
        const groupedItems = groupBulletPoints(section.items);
        const stack: any[] = [];
        
        groupedItems.forEach(g => {
          if (g.key) {
            if (g.values.length === 1) {
              stack.push({
                text: [
                  { text: g.key + ": ", bold: true },
                  g.values[0].text
                ],
                margin: [0, 2, 0, 2]
              });
            } else {
              stack.push({
                text: g.key + ":",
                bold: true,
                margin: [0, 2, 0, 2]
              });
              stack.push({
                ul: g.values.map(v => ({ text: v.text, fontSize: styles.bodyFontSize })),
                fontSize: 13,
                margin: isModern ? [25, 0, 0, 2] : [0, 0, 0, 2]
              });
            }
          } else {
            stack.push({
              ul: g.values.map(v => ({ text: v.text, fontSize: styles.bodyFontSize })),
              fontSize: 13,
              margin: isModern ? [25, 2, 0, 2] : [0, 2, 0, 2]
            });
          }
        });
        
        content.push({
          stack: stack,
          style: 'bodyText',
          margin: [0, 0, 0, 5]
        });
      }
    });
  }

  const docDefinition = {
    content: content,
    styles: {
      nameHeader: {
        fontSize: styles.nameFontSize,
        bold: true
      },
      sectionHeader: {
        fontSize: styles.bodyFontSize,
        bold: true
      },
      bodyText: {
        fontSize: styles.bodyFontSize
      }
    },
    defaultStyle: {
      font: 'Roboto', // pdfmake default font
      lineHeight: 1
    }
  };

  const fileName = `${data.fullName.trim().replace(/\s+/g, '.')}.Formatted.pdf`;
  pm.createPdf(docDefinition).download(fileName);
};
