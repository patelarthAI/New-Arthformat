import {
  Document as DocxDocument,
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
import { cleanBullet, groupBulletPoints, processDescription, formatResumeDate as formatModernDate, stripTrailingDate } from "@/utils/formatters";

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

export const generateResumeDoc = async (
  data: ResumeData, 
  format: ResumeFormat = ResumeFormat.CLASSIC_PROFESSIONAL,
  options?: { location?: boolean; phone?: boolean; email?: boolean },
  customFont?: string,
  customFontSize?: number
): Promise<Blob> => {
  const isModern = format === ResumeFormat.MODERN_EXECUTIVE;
  const isClassic = !isModern;
  
  // Dynamic Styles
  const FONT_FAMILY = customFont || (isModern ? "Arial" : "Calibri");
  const baseFontSize = customFontSize || 11;
  const SIZE_TEXT = baseFontSize * 2; // half-points
  const SIZE_NAME = (baseFontSize + 2) * 2; // Name is +2pt larger than body (half-points)


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
    if (!text) text = "";
    let cleaned = text.trim();
    cleaned = cleaned.replace(/[:\-–—_*\s~▪•·|]+$/, ""); // strip trailing colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
    cleaned = cleaned.replace(/^[:\-–—_*\s~▪•·|]+/, "");  // strip leading colons, hyphens, en/em dashes, underscores, stars, spaces, bullets, pipes
    const title = `${cleaned}:`;
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
    const cleanCompany = stripTrailingDate(company);
    const cleanLocation = location ? formatLocation(location) : "";
    const leftText = cleanLocation ? `${cleanCompany}, ${cleanLocation}` : cleanCompany;
    
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
          text: `\t${formatModernDate(dates, isClassic)}`, // Tab to right, then date
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
    const maxLen = Math.max(...items.map(i => i.length));
    const numCols = maxLen < 35 ? 3 : 2;
    const rows = Math.ceil(items.length / numCols);
    const tableRows = [];

    for (let i = 0; i < rows; i++) {
      const cells = [];
      for (let c = 0; c < numCols; c++) {
        const itemIndex = i + c * rows;
        const item = items[itemIndex];
        
        if (!item) {
          cells.push(new TableCell({
            children: [new Paragraph({ text: "" })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }
          }));
          continue;
        }

        cells.push(new TableCell({
          children: [
            new Paragraph({
              numbering: {
                reference: "custom-bullet",
                level: 0
              },
              spacing: SINGLE_LINE,
              children: [
                new TextRun({ text: item, font: FONT_FAMILY, size: SIZE_TEXT, color: COLOR_BLACK })
              ]
            })
          ],
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

  const doc = new DocxDocument({
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
                  font: FONT_FAMILY,
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
          ...(!isModern && options && (options.location || options.phone || options.email) ? [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: SINGLE_LINE,
              children: [
                new TextRun({
                  text: [
                    options.phone && data.contactInfo?.phone,
                    options.email && data.contactInfo?.email,
                    options.location && data.contactInfo?.location ? formatLocation(data.contactInfo.location) : null
                  ].filter(Boolean).join(" | "),
                  font: FONT_FAMILY,
                  size: SIZE_TEXT,
                  color: COLOR_BLACK,
                })
              ]
            })
          ] : []),
          ...(isModern && (data.contactInfo?.location || (options && (options.phone || options.email))) ? [
            new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 200 }, // Add some space after header
                children: [
                    new TextRun({
                        text: (options && (options.phone || options.email)) ? (
                            [
                                (options.location || (!options.phone && !options.email)) && data.contactInfo?.location ? formatLocation(data.contactInfo.location) : null,
                                options.phone && data.contactInfo?.phone,
                                options.email && data.contactInfo?.email
                            ].filter(Boolean).join(" | ")
                        ) : (
                            data.contactInfo?.location ? formatLocation(data.contactInfo.location) : ""
                        ),
                        font: FONT_FAMILY,
                        size: SIZE_NAME, // Modern: 12pt (same as name), Classic: 11pt
                        bold: true,
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
                        children: [new TextRun({ text: formatModernDate(exp.dates, isClassic), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                    }));
                  }
                  // Company, Location
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${stripTrailingDate(exp.company)}${exp.location ? `, ${formatLocation(exp.location)}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  // Title
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: stripTrailingDate(exp.title), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: stripTrailingDate(exp.title),
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
                        children: [new TextRun({ text: formatModernDate(exp.dates, isClassic), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                    }));
                  }
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: `${stripTrailingDate(exp.company)}${exp.location ? `, ${formatLocation(exp.location)}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
                  elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [new TextRun({ text: stripTrailingDate(exp.title), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                  }));
              } else {
                  // Classic Layout
                  elements.push(createJobHeader(exp.company, exp.location || "", exp.dates));
                  elements.push(new Paragraph({
                     spacing: SINGLE_LINE,
                     children: [
                       new TextRun({
                         text: stripTrailingDate(exp.title),
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
                          children: [new TextRun({ text: formatModernDate(edu.dates, isClassic), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                      }));
                    }
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: `${stripTrailingDate(edu.institution)}${edu.location ? `, ${formatLocation(edu.location)}` : ''}`, font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
                   elements.push(new Paragraph({
                       spacing: SINGLE_LINE,
                       children: [new TextRun({ text: stripTrailingDate(edu.degree), font: FONT_FAMILY, size: SIZE_TEXT, bold: true, color: COLOR_BLACK })]
                   }));
               } else {
                   // Classic Layout
                   elements.push(createJobHeader(edu.institution, edu.location || "", edu.dates));
                   elements.push(new Paragraph({
                      spacing: SINGLE_LINE,
                      children: [
                        new TextRun({
                          text: stripTrailingDate(edu.degree),
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