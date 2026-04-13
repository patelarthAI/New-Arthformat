import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  TabStopType,
  TabStopPosition,
} from "docx";
import { ResumeData, ResumeFormat } from "@/types";
import { cleanBullet, groupBulletPoints, processDescription } from "@/utils/formatters";

// CONSTANTS
const FONT_FAMILY = "Calibri";
const COLOR_BLACK = "000000"; // STRICTLY BLACK

// Sizes (Half-points): 22 = 11pt, 28 = 14pt
const SIZE_NAME = 28;       // 14pt
const SIZE_TEXT = 22;       // 11pt

// Margins: Narrow (0.5 inch)
const NARROW_MARGIN = convertInchesToTwip(0.5);
const MARGINS = {
  top: NARROW_MARGIN,
  bottom: NARROW_MARGIN,
  left: NARROW_MARGIN,
  right: NARROW_MARGIN,
};

// Calculate writable width for tabs (8.5in - 0.5in - 0.5in = 7.5in)
const WRITABLE_WIDTH_TWIPS = convertInchesToTwip(7.5);

// Spacing: Single line (240 twips), 0 before/after
const SINGLE_LINE = {
    line: 240,
    before: 0,
    after: 0,
};

export const generateResumeDoc = async (data: ResumeData, format: ResumeFormat = ResumeFormat.CLASSIC_PROFESSIONAL): Promise<Blob> => {
  const isModern = format === ResumeFormat.MODERN_EXECUTIVE;
  
  // Dynamic Styles
  const FONT_FAMILY = isModern ? "Arial" : "Calibri";
  const SIZE_NAME = isModern ? 24 : 28; // 12pt vs 14pt (half-points)
  const SIZE_TEXT = 22; // 11pt

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

  const emptyLine = () => new Paragraph({
      text: "",
      children: [new TextRun({ text: "", font: FONT_FAMILY, size: SIZE_TEXT })],
      spacing: { after: 0, before: 0, line: 240 },
  });

  // Helper for manual bullets to ensure exact size control
  // Hanging indent: First line starts at 0 relative to indent, wrapped lines start at 0.25in.
  // We place a bullet, a tab, then text.
  const createBulletParagraph = (text: string) => {
      return new Paragraph({
          numbering: {
              reference: "custom-bullet",
              level: 0
          },
          spacing: SINGLE_LINE,
          children: [
              new TextRun({ 
                  text: text, 
                  font: FONT_FAMILY, 
                  size: SIZE_TEXT, 
                  color: COLOR_BLACK 
              })
          ]
      });
  };

  // Dynamic Header Creator
  const createSectionHeader = (text: string) => {
    const title = text.trim().endsWith(':') ? text.trim() : `${text.trim()}:`;
    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { ...SINGLE_LINE, before: 0, after: 0 },
      border: undefined,
      children: [
        new TextRun({
          text: title,
          font: FONT_FAMILY,
          size: SIZE_TEXT,
          bold: true,
          allCaps: true,
          color: COLOR_BLACK,
        }),
      ],
    });
  };

  // Job Header: Company, Location (Bold) ... Dates (Bold)
  // Uses TabStop for right alignment instead of Table to prevent premature wrapping
  const createJobHeader = (company: string, location: string, dates?: string) => {
    const leftText = location ? `${company}, ${location}` : company;
    
    const children = [
      new TextRun({
        text: leftText,
        font: FONT_FAMILY,
        size: SIZE_TEXT,
        bold: true,
        color: COLOR_BLACK,
      })
    ];

    if (dates && dates !== "undefined") {
      children.push(
        new TextRun({
          text: `\t${dates}`, // Tab to right, then date
          font: FONT_FAMILY,
          size: SIZE_TEXT,
          bold: true,
          color: COLOR_BLACK,
        })
      );
    }

    return new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: SINGLE_LINE,
      tabStops: [
        {
          type: TabStopType.RIGHT,
          position: WRITABLE_WIDTH_TWIPS,
        },
      ],
      children: children,
    });
  };

  const createColumnList = (items: string[]) => {
    const groupedItems = groupBulletPoints(items);
    const maxLen = Math.max(...items.map(i => i.length));
    const numCols = maxLen < 35 ? 3 : 2;
    const rows = Math.ceil(groupedItems.length / numCols);
    const tableRows = [];

    for (let i = 0; i < rows; i++) {
      const cells = [];
      for (let c = 0; c < numCols; c++) {
        const itemIndex = i + c * rows;
        const g = groupedItems[itemIndex];
        
        if (!g) {
          cells.push(new TableCell({
            children: [new Paragraph({ text: "" })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }
          }));
          continue;
        }

        const cellChildren: Paragraph[] = [];

        if (g.key) {
          if (g.values.length === 1) {
            cellChildren.push(new Paragraph({
              spacing: SINGLE_LINE,
              children: [
                new TextRun({ text: g.key + ": ", font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK, bold: true }),
                new TextRun({ text: g.values[0].text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
              ]
            }));
          } else {
            cellChildren.push(new Paragraph({
              spacing: SINGLE_LINE,
              children: [
                new TextRun({ text: g.key + ":", font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK, bold: true })
              ]
            }));
            g.values.forEach(v => {
              cellChildren.push(new Paragraph({
                numbering: {
                  reference: "custom-bullet",
                  level: 0
                },
                spacing: SINGLE_LINE,
                children: [
                  new TextRun({ text: v.text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
                ]
              }));
            });
          }
        } else {
          g.values.forEach(v => {
            cellChildren.push(new Paragraph({
              numbering: {
                reference: "custom-bullet",
                level: 0
              },
              spacing: SINGLE_LINE,
              children: [
                new TextRun({ text: v.text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
              ]
            }));
          });
        }

        cells.push(new TableCell({
          children: cellChildren,
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          margins: { top: 0, bottom: 0, left: 0, right: convertInchesToTwip(0.1) }
        }));
      }
      tableRows.push(new TableRow({ children: cells }));
    }

    return [new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE },
        bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.NONE }
      }
    })];
  };

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "custom-bullet",
          levels: [
            {
              level: 0,
              format: "bullet",
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { 
                    left: convertInchesToTwip(isModern ? 0.5 : 0.25), 
                    hanging: convertInchesToTwip(0.25) 
                  },
                },
                run: {
                  font: "Arial",
                  size: 26, // 13pt bullet size
                },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK },
          paragraph: { spacing: SINGLE_LINE }
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: MARGINS },
        },
        children: [
          // 1. NAME
          new Paragraph({
            alignment: isModern ? AlignmentType.LEFT : AlignmentType.CENTER,
            spacing: SINGLE_LINE,
            children: [
              new TextRun({
                text: data.fullName,
                font: FONT_FAMILY,
                size: SIZE_NAME,
                bold: true,
                color: COLOR_BLACK,
              }),
            ],
          }),
          // Contact Info
          ...(isModern && data.contactInfo?.location ? [
            new Paragraph({
                alignment: isModern ? AlignmentType.LEFT : AlignmentType.CENTER,
                spacing: { after: 200 }, // Add some space after header
                children: [
                    new TextRun({
                        text: data.contactInfo?.location || "", // Always only location for privacy
                        font: FONT_FAMILY,
                        size: isModern ? SIZE_NAME : SIZE_TEXT, // Modern: 12pt (same as name), Classic: 11pt
                        bold: isModern, // Modern: Bold
                        color: COLOR_BLACK,
                    })
                ]
            })
          ] : []),
          emptyLine(),

          // 2. SUMMARY
          ...(data.summary ? [
            createSectionHeader(data.sectionTitleSummary || "SUMMARY"),
            ...(isModern ? [emptyLine()] : []),
            ...processDescription(Array.isArray(data.summary) ? data.summary : [data.summary]).map(rawItem => {
               const item = cleanBullet(rawItem);
               if ((Array.isArray(data.summary) && data.summary.length > 1) || processDescription([data.summary as any]).length > 1) {
                  return createBulletParagraph(item);
               }
               return new Paragraph({
                  children: [
                    new TextRun({
                      text: item,
                      font: FONT_FAMILY,
                      size: SIZE_TEXT,
                      color: COLOR_BLACK,
                    }),
                  ],
                  spacing: SINGLE_LINE,
               });
            }),
            emptyLine(),
          ] : []),

          // 3. EXPERIENCE
          ...(data.experience && data.experience.length > 0 ? [
            createSectionHeader(data.sectionTitleExperience || "PROFESSIONAL EXPERIENCE"),
            ...(isModern ? [emptyLine()] : []),
            ...data.experience.flatMap((exp) => {
              const elements = [];
              
              if (isModern) {
                  // Modern Layout: Date -> Company -> Title
                  // Date
                  if (exp.dates && exp.dates !== "undefined") {
                    elements.push(new Paragraph({
                        spacing: SINGLE_LINE,
                        children: [new TextRun({ text: formatModernDate(exp.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                    }));
                  }
                  // Company, Location
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  // Title
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: exp.title, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: exp.title,
                         font: FONT_FAMILY,
                         size: SIZE_TEXT,
                         bold: true,
                         color: COLOR_BLACK,
                       }),
                     ],
                  }));
              }

              if (exp.description) {
                processDescription(exp.description).forEach(bullet => {
                  elements.push(createBulletParagraph(bullet));
                });
              }
              elements.push(emptyLine());
              return elements;
            }),
          ] : []),

          // 4. INTERNSHIPS (Handle exactly like experience)
          ...(data.internships && data.internships.length > 0 ? [
            createSectionHeader(data.sectionTitleInternships || "INTERNSHIPS"),
            ...(isModern ? [emptyLine()] : []),
            ...data.internships.flatMap((exp) => {
              const elements = [];
              
              if (isModern) {
                  // Modern Layout
                  if (exp.dates && exp.dates !== "undefined") {
                    elements.push(new Paragraph({
                        spacing: SINGLE_LINE,
                        children: [new TextRun({ text: formatModernDate(exp.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                    }));
                  }
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${exp.company}${exp.location ? `, ${exp.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: exp.title, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: exp.title,
                         font: FONT_FAMILY,
                         size: SIZE_TEXT,
                         bold: true,
                         color: COLOR_BLACK,
                       }),
                     ],
                  }));
              }

              if (exp.description) {
                processDescription(exp.description).forEach(bullet => {
                  elements.push(createBulletParagraph(bullet));
                });
              }
              elements.push(emptyLine());
              return elements;
            }),
          ] : []),

          // 5. EDUCATION
          ...(data.education && data.education.length > 0 ? [
            createSectionHeader(data.sectionTitleEducation || "EDUCATION"),
            ...(isModern ? [emptyLine()] : []),
            ...data.education.flatMap((edu) => {
               const elements = [];
               
               if (isModern) {
                   // Modern Layout: Date -> Institution -> Degree
                   if (edu.dates && edu.dates !== "undefined") {
                     elements.push(new Paragraph({
                         spacing: SINGLE_LINE,
                         children: [new TextRun({ text: formatModernDate(edu.dates), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                     }));
                   }
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: `${edu.institution}${edu.location ? `, ${edu.location}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: edu.degree, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
               } else {
                   // Classic Layout
                   elements.push(createJobHeader(edu.institution, edu.location || "", edu.dates));
                   elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [
                        new TextRun({
                          text: edu.degree,
                          font: FONT_FAMILY,
                          size: SIZE_TEXT,
                          bold: true,
                          color: COLOR_BLACK,
                        }),
                      ],
                   }));
               }

               if (edu.details && edu.details.length > 0) {
                 processDescription(edu.details).forEach(detail => {
                    elements.push(createBulletParagraph(detail));
                 });
               }
               elements.push(emptyLine());
               return elements;
            }),
          ] : []),

          // 6. CUSTOM SECTIONS (Skills, Tools, Languages, etc.)
          ...(data.customSections ? data.customSections.flatMap(section => {
             const titleUpper = section.title.toUpperCase();
             const isGridCandidate = titleUpper.includes("SKILLS") || titleUpper.includes("COMPETENCIES") || titleUpper.includes("LANGUAGES");
             const hasLongItems = section.items && section.items.some(item => item.length > 60);
             const useColumns = isGridCandidate && !hasLongItems && section.items && section.items.length > 2;

             const elements = [];
             elements.push(createSectionHeader(section.title));
             if (isModern) elements.push(emptyLine());
             
             if (useColumns && section.items) {
               const cleanedItems = section.items.map(i => cleanBullet(i));
               elements.push(...createColumnList(cleanedItems));
             } else if (section.items) {
               const groupedItems = groupBulletPoints(section.items);
               groupedItems.forEach(g => {
                 if (g.key) {
                   if (g.values.length === 1) {
                     elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [
                         new TextRun({ text: g.key + ": ", font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK, bold: true }),
                         new TextRun({ text: g.values[0].text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
                       ]
                     }));
                   } else {
                     elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [
                         new TextRun({ text: g.key + ":", font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK, bold: true })
                       ]
                     }));
                     g.values.forEach(v => {
                       elements.push(new Paragraph({
                         numbering: {
                           reference: "custom-bullet",
                           level: 0
                         },
                         spacing: SINGLE_LINE,
                         children: [
                           new TextRun({ text: v.text, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
                         ]
                       }));
                     });
                   }
                 } else {
                   g.values.forEach(v => {
                     elements.push(createBulletParagraph(v.text));
                   });
                 }
               });
             }
             elements.push(emptyLine());
             return elements;
          }) : []),

        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
};