import { ResumeData, ResumeFormat } from "@/types";
import { cleanBullet, groupBulletPoints, processDescription, formatResumeDate as formatModernDate, stripTrailingDate } from "@/utils/formatters";

// Helper to format title with colon
const formatTitle = (title: string) => {
  if (!title) return "";
  let cleaned = title.trim();
  cleaned = cleaned.replace(/[:\-–—_*\s~▪•·|]+$/, ""); // strip trailing colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
  cleaned = cleaned.replace(/^[:\-–—_*\s~▪•·|]+/, "");  // strip leading colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
  return `${cleaned}:`;
};

// Helper to shorten state names, capitalize city names, and retain just City, State
const formatLocation = (loc: string) => {
  if (!loc) return "";
  const cleanedLoc = loc.replace(/\b\d{5}(-\d{4})?\b/g, '').trim();
  const parts = cleanedLoc.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length >= 1) {
    parts[0] = parts[0].split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    if (parts.length >= 2) {
      const state = parts[1];
      const stateMap: { [key: string]: string } = {
        "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
        "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
        "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
        "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
        "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
        "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
        "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
        "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
        "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
        "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
      };
      const foundState = Object.keys(stateMap).find(s => s.toLowerCase() === state.toLowerCase());
      if (foundState) {
        parts[1] = stateMap[foundState];
      } else if (state.length > 2) {
        parts[1] = state.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
      } else {
        parts[1] = state.toUpperCase();
      }
    }
    return parts.slice(0, 2).join(', ');
  }
  return cleanedLoc;
};

export const generateResumePDF = async (
  data: ResumeData, 
  format: ResumeFormat | string = ResumeFormat.CLASSIC_PROFESSIONAL,
  options?: { location?: boolean; phone?: boolean; email?: boolean }
) => {
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
  const isClassic = !isModern;
  
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
  if (isModern) {
      const modernLocation = (options?.location || (!options?.phone && !options?.email)) && data.contactInfo?.location 
          ? formatLocation(data.contactInfo.location) 
          : "";
      const modernPhoneAndEmail = (options?.phone || options?.email) 
          ? [
              options.phone && data.contactInfo?.phone,
              options.email && data.contactInfo?.email
            ].filter(Boolean).join(" | ")
          : "";
      
      const fullContact = [modernLocation, modernPhoneAndEmail].filter(Boolean).join(" | ");
      if (fullContact) {
          content.push({
              text: fullContact,
              fontSize: 12,
              bold: true,
              alignment: styles.nameAlignment,
              margin: [0, 0, 0, 15]
          });
      }
  } else if (options && (options.location || options.phone || options.email)) {
      content.push({
          text: [
              options.phone && data.contactInfo?.phone,
              options.email && data.contactInfo?.email,
              options.location && data.contactInfo?.location ? formatLocation(data.contactInfo.location) : null
          ].filter(Boolean).join(" | "),
          fontSize: 11,
          alignment: 'center',
          margin: [0, 0, 0, 10]
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
                text: formatModernDate(exp.dates, isClassic),
                style: 'bodyText',
                bold: true,
                margin: [0, 0, 0, 2]
            });
          }
          content.push({
              text: `${stripTrailingDate(exp.company)}${exp.location ? `, ${formatLocation(exp.location)}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: stripTrailingDate(exp.title),
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          // Classic Layout: Company | Date -> Title
          const columns: any[] = [
            {
              text: [
                { text: stripTrailingDate(exp.company), bold: true },
                exp.location ? `, ${formatLocation(exp.location)}` : ''
              ],
              style: 'bodyText',
              width: '*'
            }
          ];
          
          if (exp.dates && exp.dates !== "undefined") {
            columns.push({
              text: formatModernDate(exp.dates, isClassic),
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
            text: stripTrailingDate(exp.title),
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
                text: formatModernDate(exp.dates, isClassic),
                style: 'bodyText',
                bold: true,
                margin: [0, 0, 0, 2]
            });
          }
          content.push({
              text: `${stripTrailingDate(exp.company)}${exp.location ? `, ${formatLocation(exp.location)}` : ''}`,
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 2]
          });
          content.push({
              text: stripTrailingDate(exp.title),
              style: 'bodyText',
              bold: true,
              margin: [0, 0, 0, 4]
          });
      } else {
          const columns: any[] = [
            {
              text: [
                { text: stripTrailingDate(exp.company), bold: true },
                exp.location ? `, ${formatLocation(exp.location)}` : ''
              ],
              style: 'bodyText',
              width: '*'
            }
          ];
          
          if (exp.dates && exp.dates !== "undefined") {
            columns.push({
              text: formatModernDate(exp.dates, isClassic),
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
            text: stripTrailingDate(exp.title),
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
            { text: stripTrailingDate(edu.institution), bold: true },
            edu.location ? `, ${formatLocation(edu.location)}` : ''
          ],
          style: 'bodyText',
          width: '*'
        }
      ];
      
      if (edu.dates && edu.dates !== "undefined") {
        columns.push({
          text: formatModernDate(edu.dates, isClassic),
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
        text: stripTrailingDate(edu.degree),
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
        const cleanedItems = section.items.map(i => cleanBullet(i));
        const maxLen = Math.max(...cleanedItems.map(i => i.length));
        const numCols = maxLen < 35 ? 3 : 2;
        const colItems: string[][] = Array.from({ length: numCols }, () => []);
        
        const rows = Math.ceil(cleanedItems.length / numCols);
        cleanedItems.forEach((item, idx) => {
          const colIdx = Math.floor(idx / rows);
          if (colItems[colIdx]) {
            colItems[colIdx].push(item);
          }
        });

        const columns = colItems.map(itemsInCol => {
          if (itemsInCol.length === 0) return { text: "" };
          return {
            ul: itemsInCol.map(item => ({ text: item, fontSize: styles.bodyFontSize })),
            fontSize: 13,
            margin: isModern ? [25, 0, 0, 0] : [0, 0, 0, 0]
          };
        });

        content.push({
          columns: columns,
          margin: [0, 0, 0, 5],
          style: 'bodyText'
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
