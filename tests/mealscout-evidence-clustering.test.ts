import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  createMealScoutEvidenceFile,
  clusterMealScoutEvidenceFiles,
  classifyMealScoutDetectedType
} = await import('../src/mealscoutEvidenceClustering.ts');

test('classifies random unknown intake files by content signals not filename', () => {
  const evidence = createMealScoutEvidenceFile({
    fileId: 'x-1',
    fileName: 'IMG_9321.PNG',
    drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_9321.PNG',
    sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/',
    extractedSignals: { menuItems: [{ name: 'Brisket Taco', price: '$4.00' }] }
  });

  assert.equal(evidence.detectedType, 'menu');
});

test('clusters one truck from mixed random files', () => {
  const files = [
    createMealScoutEvidenceFile({
      fileId: 'f1',
      fileName: 'a.png',
      drivePath: '/incoming/unknown/a.png',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { truckName: 'Bayou Bites', phone: '985-111-2222', cityArea: 'New Orleans', cuisine: 'Cajun', instagram: '@bayoubites' }
    }),
    createMealScoutEvidenceFile({
      fileId: 'f2',
      fileName: 'b.png',
      drivePath: '/incoming/unknown/b.png',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { instagram: '@bayoubites', menuItems: [{ name: 'Shrimp Po Boy', price: '$12' }] }
    }),
    createMealScoutEvidenceFile({
      fileId: 'f3',
      fileName: 'c.png',
      drivePath: '/incoming/unknown/c.png',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { website: 'https://bayoubites.example', phone: '9851112222' }
    })
  ];

  const clusters = clusterMealScoutEvidenceFiles(files);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].files.length, 3);
});

test('clusters mixed multi-truck dump without filename discipline', () => {
  const files = [
    createMealScoutEvidenceFile({
      fileId: 'a1',
      fileName: 'IMG_0012.PNG',
      drivePath: '/incoming/unknown/IMG_0012.PNG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { truckName: 'Bayou Bites', phone: '985-111-2222', cityArea: 'New Orleans', cuisine: 'Cajun' }
    }),
    createMealScoutEvidenceFile({
      fileId: 'a2',
      fileName: 'IMG_0013.PNG',
      drivePath: '/incoming/unknown/IMG_0013.PNG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { instagram: '@bayoubites', menuItems: [{ name: 'Shrimp Po Boy' }] }
    }),
    createMealScoutEvidenceFile({
      fileId: 'b1',
      fileName: 'PIC_7711.JPG',
      drivePath: '/incoming/unknown/PIC_7711.JPG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { truckName: 'Taco Orbit', phone: '985-777-4444', cityArea: 'Metairie', cuisine: 'Mexican', website: 'https://tacoorbit.example' }
    }),
    createMealScoutEvidenceFile({
      fileId: 'b2',
      fileName: 'PIC_7712.JPG',
      drivePath: '/incoming/unknown/PIC_7712.JPG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: { website: 'https://tacoorbit.example', menuItems: [{ name: 'Brisket Taco' }] }
    })
  ];

  const clusters = clusterMealScoutEvidenceFiles(files);
  assert.equal(clusters.length >= 2 && clusters.length <= 3, true);
  assert.equal(clusters.some((item) => item.files.length >= 2), true);
});

test('separate menu screenshot stays linked by content signals', () => {
  const profile = createMealScoutEvidenceFile({
    fileId: 'p1',
    fileName: 'truck-main.png',
    drivePath: '/incoming/screenshots/truck-main.png',
    sourceFolder: '/incoming/screenshots',
    extractedSignals: { truckName: 'Smoke Stop', phone: '985-333-7777', cityArea: 'Kenner', cuisine: 'BBQ' }
  });

  const menu = createMealScoutEvidenceFile({
    fileId: 'm1',
    fileName: 'menu-only.png',
    drivePath: '/incoming/menus/menu-only.png',
    sourceFolder: '/incoming/menus',
    extractedSignals: { phone: '9853337777', menuItems: [{ name: 'Rib Plate', price: '$14' }] }
  });

  const clusters = clusterMealScoutEvidenceFiles([profile, menu]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].files.some((file) => file.fileId === 'm1'), true);
});

test('logo unmatched remains uncertain cluster', () => {
  const logo = createMealScoutEvidenceFile({
    fileId: 'logo-x',
    fileName: 'logo.png',
    drivePath: '/incoming/logos/logo.png',
    sourceFolder: '/incoming/logos',
    extractedSignals: {},
    visualHints: { hasLogo: true }
  });

  const clusters = clusterMealScoutEvidenceFiles([logo]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].reviewStatus, 'uncertain_match');
});

test('single-truck mixed profile menu logo consolidates into one cluster', () => {
  const files = [
    createMealScoutEvidenceFile({
      fileId: 'pilot-1-profile',
      fileName: 'IMG_1021.PNG',
      drivePath: '/incoming/unknown/IMG_1021.PNG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: {
        truckName: 'Big Mikes Taco Truck',
        phone: '985-111-2222',
        email: 'bigmikes@example.com',
        cityArea: 'New Orleans',
        cuisine: 'Mexican'
      }
    }),
    createMealScoutEvidenceFile({
      fileId: 'pilot-1-menu',
      fileName: 'IMG_1033.PNG',
      drivePath: '/incoming/unknown/IMG_1033.PNG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: {
        menuItems: [
          { name: 'Brisket Taco', price: '$4.50' },
          { name: 'Chicken Taco', price: '$4.00' }
        ]
      }
    }),
    createMealScoutEvidenceFile({
      fileId: 'pilot-1-logo',
      fileName: 'IMG_1044.PNG',
      drivePath: '/incoming/unknown/IMG_1044.PNG',
      sourceFolder: '/incoming/unknown',
      extractedSignals: {
        truckName: 'Big Mikes Taco Truck'
      },
      visualHints: { hasLogo: true }
    })
  ];

  const clusters = clusterMealScoutEvidenceFiles(files);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].files.length, 3);
});

test('duplicate possible cluster is marked when matching existing profiles', () => {
  const file = createMealScoutEvidenceFile({
    fileId: 'd1',
    fileName: 'x.png',
    drivePath: '/incoming/unknown/x.png',
    sourceFolder: '/incoming/unknown',
    extractedSignals: {
      truckName: 'Bayou Bites',
      phone: '985-111-2222',
      cityArea: 'New Orleans',
      cuisine: 'Cajun',
      menuItems: [{ name: 'Shrimp Po Boy' }]
    }
  });

  const clusters = clusterMealScoutEvidenceFiles([file], [
    {
      existingProfileId: 'existing-1',
      truckName: 'Bayou Bites',
      phone: '9851112222',
      cityArea: 'New Orleans'
    }
  ]);

  assert.equal(clusters[0].reviewStatus, 'duplicate_possible');
});

test('classifier supports schedule and social detection', () => {
  const schedule = classifyMealScoutDetectedType({
    sourceFolder: '/incoming/unknown',
    visualHints: { hasHoursGrid: true }
  });
  const social = classifyMealScoutDetectedType({
    sourceFolder: '/incoming/unknown',
    extractedSignals: { instagram: '@truck' }
  });

  assert.equal(schedule.detectedType, 'schedule');
  assert.equal(social.detectedType, 'social');
});
